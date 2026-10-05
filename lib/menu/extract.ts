import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, generateText, Output, RetryError, type LanguageModel } from "ai";
import { z } from "zod";
import type { ExtractedMenu } from "@/lib/types";
import type { Sources } from "@/lib/menu/collect";

export const PROMPT_VERSION = 1;
export const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_TEXT_CHARS = 40_000;

const DishSchema = z.object({
  section: z.string().describe("Menu section heading as written, or empty string"),
  name: z.string().describe("Dish name copied verbatim from the menu"),
  description: z.string().describe("Dish description copied verbatim, or empty string"),
  price: z.string().describe("Price as written, or empty string"),
  eggStatus: z
    .enum(["egg_main", "egg_component", "no_egg"])
    .describe(
      "egg_main: egg is the dish (omelette, eggs benedict, shakshuka, scrambled eggs on toast, frittata). " +
        "egg_component: egg is a named, removable part (full English with fried egg, avocado toast with poached egg). " +
        "no_egg: egg not named in the name or description (porridge, granola, pancakes, bacon sandwich, French toast).",
    ),
  eggEvidence: z.string().describe("The exact words from the menu that mention egg, or empty string for no_egg"),
  substantial: z
    .boolean()
    .describe("false for plain toast, a single pastry, a side, a sauce/extra, or a bowl of fruit; true for a proper breakfast dish"),
});

export const MenuSchema: z.ZodType<ExtractedMenu> = z.object({
  menuFound: z.boolean().describe("true if the content contains an actual food menu with dish names"),
  hasBreakfast: z.boolean().describe("true if the menu has breakfast, brunch or all-day breakfast dishes"),
  servedUntil: z.string().describe('When breakfast is served until, e.g. "until 11:30", or empty string'),
  dishes: z.array(DishSchema).describe("Breakfast and brunch dishes only. Exclude drinks, lunch, dinner, desserts."),
});

const INSTRUCTIONS = `You read café websites and extract the breakfast/brunch menu.
Rules:
- Copy dish names, descriptions and prices exactly as written. Never invent dishes.
- Include only breakfast, brunch and all-day breakfast dishes. Skip drinks, lunch, dinner, cakes and desserts.
- Skip catering, sharing platters for groups, retail/shop products, and items marked as available only in another
  region (e.g. "(NI)" for Northern Ireland only).
- Classify egg only by what the menu text says. Ignore hidden egg in batter, bread, brioche, mayo or sauces.
  French toast, pancakes and waffles are no_egg unless egg is named.
- If the word egg/eggs, or an egg dish (omelette, frittata, shakshuka, benedict, royale, florentine), appears in the
  dish NAME, the dish is never no_egg.
- egg_main: cooked egg is the centre of the dish, even when served with something (smoked salmon and scrambled eggs,
  eggs any style on toast, bacon and egg roll, egg and avocado, poached eggs on toast).
- egg_component: egg is one item on a mixed plate of three or more named components that would still be a meal
  without it (full English, vegetarian breakfast, avocado-feta-dukkah toast topped with a poached egg).
  Treat every full/English/vegetarian/house "breakfast" plate the same way: egg_component.
- Hollandaise alone does not make a dish egg_main; eggs Benedict/Florentine/Royale do (the poached eggs are the dish).
- If an item says "add egg" as an optional extra, the dish is no_egg.
- substantial=false for pastries, croissants, buns, muffins, cakes, cookies, granola bars, fruit, grab-and-go yoghurt
  or chia pots, sides, extras, and toast with only a spread. substantial=true for a plated or made-to-order dish,
  a filled sandwich/bagel/croissant, porridge, pancakes, or a full breakfast bowl.
- Content may include photos of a printed menu: read them the same way.
- If the content has no real menu (just opening hours, booking, "see our menu" links), set menuFound=false and return no dishes.`;

export type ExtractFn = (sources: Sources) => Promise<ExtractedMenu>;

function defaultModel(): LanguageModel {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  // The workspace header is needed only when the API key is not scoped to a workspace.
  const anthropic = createAnthropic(workspaceId ? { headers: { "anthropic-workspace-id": workspaceId } } : {});
  return anthropic(process.env.LLM_MODEL || DEFAULT_MODEL);
}

export function createExtractor(opts: { model?: LanguageModel } = {}): ExtractFn {
  return async ({ texts, pdfs, images }) => {
    const textBlock = texts.map((t) => `--- SOURCE: ${t.url} ---\n${t.text.slice(0, MAX_TEXT_CHARS)}`).join("\n\n");
    const content: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: Buffer; mediaType: string }
      | { type: "image"; image: Buffer; mediaType: string }
    > = [{ type: "text", text: `Extract the breakfast menu from these café web pages.\n\n${textBlock}` }];
    for (const p of pdfs) {
      content.push({ type: "text", text: `--- PDF SOURCE: ${p.url} ---` });
      content.push({ type: "file", data: p.data, mediaType: "application/pdf" });
    }
    for (const img of images) {
      content.push({ type: "text", text: `--- IMAGE SOURCE: ${img.url} ---` });
      content.push({ type: "image", image: img.data, mediaType: img.mediaType });
    }
    const { output } = await generateText({
      model: opts.model ?? defaultModel(),
      system: INSTRUCTIONS,
      messages: [{ role: "user", content }],
      output: Output.object({ schema: MenuSchema }),
      temperature: 0,
    });
    return output as ExtractedMenu;
  };
}

// Worth retrying later rather than caching the café as unreadable for a week.
export function isTransientLlmError(e: unknown): boolean {
  if (RetryError.isInstance(e)) return isTransientLlmError(e.lastError);
  if (APICallError.isInstance(e)) {
    const s = e.statusCode ?? 0;
    return e.isRetryable || s === 429 || s >= 500;
  }
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}
