import { describe, expect, test } from "vitest";
import { z } from "zod";
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, isCafeAttributableLlmError, MenuSchema, PROMPT_VERSION } from "@/lib/menu/extract";
import type { ExtractedMenu } from "@/lib/types";

const menu: ExtractedMenu = {
  menuFound: true,
  hasBreakfast: true,
  servedUntil: "until 11:30",
  dishes: [
    {
      section: "Breakfast",
      name: "Porridge",
      nameRu: "Овсянка",
      description: "oats",
      descriptionRu: "овсяные хлопья",
      price: "£6",
      eggStatus: "no_egg",
      eggEvidence: "",
      substantial: true,
    },
  ],
};

const model = () =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(menu) }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });

describe("createExtractor", () => {
  test("sends texts, PDFs and images and returns the parsed menu", async () => {
    const m = model();
    const extract = createExtractor({ model: m });
    const out = await extract({
      texts: [{ url: "https://cafe.example/", text: "Breakfast Porridge £6" }],
      pdfs: [{ url: "https://cafe.example/menu.pdf", data: Buffer.from("%PDF") }],
      images: [{ url: "https://cafe.example/m.jpg", data: Buffer.from("jpg"), mediaType: "image/jpeg" }],
    });
    expect(out).toEqual(menu);

    const prompt = m.doGenerateCalls[0].prompt;
    const system = prompt.find((p) => p.role === "system");
    expect(system && "content" in system ? String(system.content) : "").toContain("Never invent dishes");
    const user = prompt.find((p) => p.role === "user");
    const parts = user && Array.isArray(user.content) ? user.content : [];
    const files = parts.filter((p) => p.type === "file");
    expect(files.map((f) => (f as { mediaType: string }).mediaType)).toEqual(["application/pdf", "image/jpeg"]);
    expect(JSON.stringify(parts)).toContain("Breakfast Porridge £6");
  });

  test("uses temperature 0", async () => {
    const m = model();
    await createExtractor({ model: m })({ texts: [{ url: "u", text: "t" }], pdfs: [], images: [] });
    expect(m.doGenerateCalls[0].temperature).toBe(0);
  });

  test("prompt version is 3", () => expect(PROMPT_VERSION).toBe(3));

  test("the prompt keeps all food orderable in the morning and counts plated dishes fairly", async () => {
    const m = model();
    await createExtractor({ model: m })({ texts: [{ url: "u", text: "t" }], pdfs: [], images: [] });
    const sent = JSON.stringify(m.doGenerateCalls[0].prompt);
    expect(sent).toContain("every food item a customer could order in the morning");
    expect(sent).toContain("toasties, sandwiches, wraps, salads");
    expect(sent).toContain("only sections the menu says start later");
    expect(sent).toContain("toast with a topping");
    expect(sent).not.toContain("Include only breakfast, brunch and all-day breakfast dishes");
    const schema = JSON.stringify(z.toJSONSchema(MenuSchema));
    expect(schema).toContain("topped toast, served bowl");
    expect(schema).not.toContain("a bowl of fruit");
  });

  test("a dish without a Russian name is rejected", () => {
    const { nameRu: _omit, ...withoutRu } = menu.dishes[0];
    expect(MenuSchema.safeParse({ ...menu, dishes: [withoutRu] }).success).toBe(false);
  });

  test("the schema tells the model how to translate", () => {
    expect(JSON.stringify(z.toJSONSchema(MenuSchema))).toContain("Яйца Бенедикт");
    expect(JSON.stringify(z.toJSONSchema(MenuSchema))).toContain("«Панкейки»");
    expect(JSON.stringify(z.toJSONSchema(MenuSchema))).toContain("«скрэмбл»");
  });
});

describe("isCafeAttributableLlmError", () => {
  const apiError = (statusCode: number, message = "x", isRetryable = false) =>
    new APICallError({ message, url: "u", requestBodyValues: {}, statusCode, isRetryable });
  const noObject = () =>
    new NoObjectGeneratedError({
      message: "No object generated",
      response: { id: "r", timestamp: new Date(), modelId: "m" },
      usage: {} as never,
      finishReason: "stop" as never,
    });

  test("the model could not produce a menu from this content", () => expect(isCafeAttributableLlmError(noObject())).toBe(true));
  test("the café's PDF or image was rejected", () => {
    expect(isCafeAttributableLlmError(apiError(400, "The PDF specified was not valid"))).toBe(true);
    expect(isCafeAttributableLlmError(apiError(400, "Could not process image"))).toBe(true);
    expect(isCafeAttributableLlmError(apiError(413, "request too large"))).toBe(true);
  });
  test.each([429, 500, 529])("status %i is ours, not the café's", (s) => expect(isCafeAttributableLlmError(apiError(s))).toBe(false));
  test.each([401, 403, 404])("account/config status %i is ours, not the café's", (s) =>
    expect(isCafeAttributableLlmError(apiError(s))).toBe(false));
  test("low credit is ours, not the café's", () =>
    expect(isCafeAttributableLlmError(apiError(400, "Your credit balance is too low to access the Anthropic API"))).toBe(false));
  test("a missing API key is ours", () => expect(isCafeAttributableLlmError(new LoadAPIKeyError({ message: "missing" }))).toBe(false));
  test("timeouts and unknown errors are ours", () => {
    expect(isCafeAttributableLlmError(new DOMException("t", "TimeoutError"))).toBe(false);
    expect(isCafeAttributableLlmError(new Error("socket hang up"))).toBe(false);
  });
  test("a RetryError is judged by its last error", () => {
    expect(isCafeAttributableLlmError(new RetryError({ message: "m", reason: "maxRetriesExceeded", errors: [apiError(529)] }))).toBe(false);
  });
});
