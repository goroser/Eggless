import { describe, expect, test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createTranslator } from "@/lib/menu/translate";

const reply = (items: unknown[]) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({ items }) }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    },
  });

describe("createTranslator", () => {
  test("returns one translation per dish, in order", async () => {
    const model = reply([
      { nameRu: "Овсянка", descriptionRu: "с ягодами" },
      { nameRu: "Блины", descriptionRu: "" },
    ]);
    const out = await createTranslator({ model })([
      { name: "Porridge", description: "with berries" },
      { name: "Pancakes", description: "" },
    ]);
    expect(out).toEqual([
      { nameRu: "Овсянка", descriptionRu: "с ягодами" },
      { nameRu: "Блины", descriptionRu: "" },
    ]);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Porridge");
    expect(model.doGenerateCalls[0].temperature).toBe(0);
  });

  test("a reply with the wrong number of items is an error", async () => {
    const model = reply([{ nameRu: "Овсянка", descriptionRu: "" }]);
    await expect(
      createTranslator({ model })([
        { name: "Porridge", description: "" },
        { name: "Pancakes", description: "" },
      ]),
    ).rejects.toThrow(/expected 2/);
  });
});
