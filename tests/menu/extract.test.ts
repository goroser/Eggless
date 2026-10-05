import { describe, expect, test } from "vitest";
import { APICallError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, isTransientLlmError, PROMPT_VERSION } from "@/lib/menu/extract";
import type { ExtractedMenu } from "@/lib/types";

const menu: ExtractedMenu = {
  menuFound: true,
  hasBreakfast: true,
  servedUntil: "until 11:30",
  dishes: [
    { section: "Breakfast", name: "Porridge", description: "oats", price: "£6", eggStatus: "no_egg", eggEvidence: "", substantial: true },
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

  test("prompt version is 1", () => expect(PROMPT_VERSION).toBe(1));
});

describe("isTransientLlmError", () => {
  const apiError = (statusCode: number, isRetryable = false) =>
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode, isRetryable });

  test.each([429, 500, 529])("status %i is transient", (s) => expect(isTransientLlmError(apiError(s))).toBe(true));
  test("isRetryable is transient", () => expect(isTransientLlmError(apiError(418, true))).toBe(true));
  test("400 is not transient", () => expect(isTransientLlmError(apiError(400))).toBe(false));
  test("timeouts are transient", () => {
    expect(isTransientLlmError(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isTransientLlmError(new DOMException("a", "AbortError"))).toBe(true);
  });
  test("a RetryError is judged by its last error", () => {
    const err = new RetryError({ message: "m", reason: "maxRetriesExceeded", errors: [apiError(529)] });
    expect(isTransientLlmError(err)).toBe(true);
  });
  test("a schema error is not transient", () => expect(isTransientLlmError(new Error("No object generated"))).toBe(false));
});
