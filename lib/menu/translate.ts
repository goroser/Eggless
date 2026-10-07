import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { defaultModel } from "@/lib/menu/extract";

export type TranslateFn = (
  items: { name: string; description: string }[],
) => Promise<{ nameRu: string; descriptionRu: string }[]>;

const ResultSchema = z.object({
  items: z.array(
    z.object({
      nameRu: z.string().describe("The dish name in natural Russian, keeping brand and proper names"),
      descriptionRu: z.string().describe("The description in natural Russian, or empty string when it is empty"),
    }),
  ),
});

const INSTRUCTIONS = `You translate London café breakfast menus into natural Russian, as a Russian speaker would say it in a café.
Keep brand and proper names (e.g. "Eggs Benedict" → «Яйца Бенедикт», "Full English" → «Полный английский завтрак»).
Never add information. Return exactly one item per input dish, in the same order.`;

// Text-only translation of dishes already stored, for menus read before prompt version 2.
export function createTranslator(opts: { model?: LanguageModel } = {}): TranslateFn {
  return async (items) => {
    const { output } = await generateText({
      model: opts.model ?? defaultModel(),
      system: INSTRUCTIONS,
      prompt: JSON.stringify(items.map((i, n) => ({ n, name: i.name, description: i.description }))),
      output: Output.object({ schema: ResultSchema }),
      temperature: 0,
    });
    const out = (output as z.infer<typeof ResultSchema>).items;
    if (out.length !== items.length) throw new Error(`translation returned ${out.length} items, expected ${items.length}`);
    return out;
  };
}
