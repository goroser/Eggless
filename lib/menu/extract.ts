import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, generateText, NoObjectGeneratedError, Output, RetryError, type LanguageModel } from "ai";
import { z } from "zod";
import type { ExtractedMenu } from "@/lib/types";
import type { Sources } from "@/lib/menu/collect";

export { PROMPT_VERSION } from "@/lib/menu/version";
export const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_TEXT_CHARS = 40_000;

const DishSchema = z.object({
  section: z.string().describe("Menu section heading as written, or empty string"),
  name: z.string().describe("Dish name copied verbatim from the menu"),
  nameRu: z
    .string()
    .describe(
      "The dish name in natural Russian, as a Russian speaker would say it in a café. Keep brand and proper names " +
        "(e.g. \"Eggs Benedict\" → «Яйца Бенедикт», \"Full English\" → «Полный английский завтрак»; " +
        "American \"pancakes\" → «Панкейки», not «Блины»; \"scrambled eggs\" → «скрэмбл», not «омлет»). Never add information.",
    ),
  description: z.string().describe("Dish description copied verbatim, or empty string"),
  descriptionRu: z
    .string()
    .describe("The full description translated into natural Russian, or empty string when there is no description. Never add information."),
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
    .describe(
      "true for a meal or proper plate (topped toast, served bowl, sandwich, toastie, wrap, salad); " +
        "false only for plain toast, a single pastry or cake, a side, an extra, or a pre-packed pot",
    ),
});

export const MenuSchema: z.ZodType<ExtractedMenu> = z.object({
  menuFound: z.boolean().describe("true if the content contains an actual food menu with dish names"),
  hasBreakfast: z.boolean().describe("true if any food on the menu can be ordered in the morning"),
  servedUntil: z.string().describe('When breakfast is served until, e.g. "until 11:30", or empty string'),
  dishes: z
    .array(DishSchema)
    .describe("Every food item a customer could order in the morning. Exclude drinks and sections the menu says start later."),
});

const INSTRUCTIONS = `You read café websites and extract the breakfast/brunch menu.
Rules:
- Copy dish names, descriptions and prices exactly as written. Never invent dishes.
- Include every food item a customer could order in the morning: breakfast and brunch dishes, and also all-day
  items such as toasties, sandwiches, wraps, salads, bowls, pastries and cakes. A café menu with no times is all-day.
- Leave out only sections the menu says start later (e.g. "Lunch from 12pm", "Dinner", "Evening menu"), and drinks.
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
- substantial=true for a meal or a proper plate: toast with a topping (avocado, mushrooms, beans, salmon), a bowl
  served at the table (granola, yoghurt, porridge, açaí), a sandwich, toastie, wrap or salad, pancakes, French toast,
  waffles, any plated or made-to-order dish. substantial=false only for plain toast or toast with butter or jam, a single
  pastry, croissant, muffin, cookie or slice of cake, a side, an extra or add-on, and grab-and-go pre-packed pots.
- Content may include photos of a printed menu: read them the same way.
- If the content has no real menu (just opening hours, booking, "see our menu" links), set menuFound=false and return no dishes.`;

export type ExtractFn = (sources: Sources, opts?: { abortSignal?: AbortSignal }) => Promise<ExtractedMenu>;

export function defaultModel(): LanguageModel {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  // The workspace header is needed only when the API key is not scoped to a workspace.
  const anthropic = createAnthropic(workspaceId ? { headers: { "anthropic-workspace-id": workspaceId } } : {});
  return anthropic(process.env.LLM_MODEL || DEFAULT_MODEL);
}

export function createExtractor(opts: { model?: LanguageModel } = {}): ExtractFn {
  return async ({ texts, pdfs, images }, callOpts = {}) => {
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
      abortSignal: callOpts.abortSignal,
    });
    return output as ExtractedMenu;
  };
}

// True only when the café's own content is the problem (the model could not read a menu from it,
// or the API rejected its PDF or image). Everything else (rate limits, outages, a bad key, no credit,
// a wrong model name) is ours to fix, so the café must not be cached as unreadable.
export function isCafeAttributableLlmError(e: unknown): boolean {
  if (RetryError.isInstance(e)) return isCafeAttributableLlmError(e.lastError);
  if (NoObjectGeneratedError.isInstance(e)) return true;
  if (APICallError.isInstance(e)) {
    if (e.statusCode === 413) return true;
    if (e.statusCode !== 400) return false;
    const text = `${e.message} ${e.responseBody ?? ""}`;
    return /pdf|image|document|media|too large|too many pages/i.test(text) && !/credit|billing|balance/i.test(text);
  }
  return false;
}
