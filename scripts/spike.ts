// Phase 0 spike: how many Chiswick breakfast cafés publish a menu we can read,
// and does the egg classification look right? Throwaway script, no UI, no DB.
// Run: npm run spike  (writes spike-output/results.json)

import { writeFile, mkdir } from "node:fs/promises";
import * as cheerio from "cheerio";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
const MODEL = process.env.LLM_MODEL || "claude-haiku-4-5";
// Needed only when the API key is not scoped to a workspace.
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID;
const anthropic = createAnthropic(WORKSPACE_ID ? { headers: { "anthropic-workspace-id": WORKSPACE_ID } } : {});
if (!PLACES_KEY || !process.env.ANTHROPIC_API_KEY) {
  throw new Error("Set GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY in .env.local");
}

// Roughly Chiswick High Road and Turnham Green.
const CHISWICK = {
  low: { latitude: 51.486, longitude: -0.275 },
  high: { latitude: 51.498, longitude: -0.245 },
};

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;
// ASCII only: some hosts (Wix) answer 403 to a non-ASCII User-Agent.
const USER_AGENT = "EgglessBot/0.1 (personal project; one fetch per cafe)";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_IMAGE_BYTES = 60 * 1024;

const MENU_WORDS = /menu|breakfast|brunch|food|eat|all-day|all_day|allday/i;
const SKIP_HOSTS = /deliveroo|ubereats|just-eat|justeat|instagram|facebook|tiktok|twitter|x\.com|opentable|resy|sevenrooms|exploretock|tock\.com|bookatable|designmynight|thefork|google\./i;

type Status = "ok" | "no_website" | "no_menu_found" | "no_breakfast" | "fetch_failed";

type Place = {
  id: string;
  displayName?: { text: string };
  websiteUri?: string;
  rating?: number;
  servesBreakfast?: boolean;
  primaryType?: string;
};

// ---------- Places ----------

async function searchPlaces(): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY!,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri,places.rating,places.servesBreakfast,places.primaryType",
    },
    body: JSON.stringify({
      textQuery: "breakfast cafe",
      locationRestriction: { rectangle: CHISWICK },
      pageSize: 20,
    }),
  });
  if (!res.ok) throw new Error(`Places search failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { places?: Place[] };
  return json.places ?? [];
}

// ---------- Fetching ----------

type Fetched = { url: string; contentType: string; body: Buffer };

async function fetchCapped(url: string, maxBytes = MAX_BYTES): Promise<Fetched> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,image/*,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (SKIP_HOSTS.test(new URL(res.url).hostname)) throw new Error(`redirected to ${res.url}`);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return { url: res.url, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
}

const isPdf = (f: Fetched) => f.contentType.includes("pdf") || /\.pdf($|\?)/i.test(f.url);
const isImage = (f: Fetched) => /^image\/(jpeg|png|webp|gif)/.test(f.contentType);

// A stale deep link on Google (e.g. a closed store page) falls back to the site root.
async function fetchHome(url: string): Promise<Fetched> {
  try {
    return await fetchCapped(url);
  } catch (e) {
    if (!/HTTP 4\d\d/.test((e as Error).message)) throw e;
    // Try the first path segment (a country/locale section like /uk/), then the root.
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0];
    const fallbacks = [first ? new URL(`/${first}/`, u).toString() : null, new URL("/", u).toString()];
    for (const fb of fallbacks) {
      if (!fb || fb === url) continue;
      try {
        return await fetchCapped(fb);
      } catch {
        // try the next one
      }
    }
    throw e;
  }
}

// Images on a menu page whose text is too thin to be the menu itself.
function findMenuImages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("img").each((_, el) => {
    const raw = $(el).attr("data-src") || $(el).attr("src") || "";
    const alt = $(el).attr("alt") ?? "";
    if (!raw || raw.startsWith("data:")) return;
    if (/logo|icon|avatar|favicon|sprite|\.svg/i.test(raw + " " + alt)) return;
    let url: string;
    try {
      url = new URL(raw, baseUrl).toString();
    } catch {
      return;
    }
    // Wix serves thumbnails like .../media/<id>~mv2.jpg/v1/fill/w_170,...; take the original.
    url = url.replace(/(static\.wixstatic\.com\/media\/[^/]+)\/v1\/.*$/, "$1");
    out.add(url);
  });
  return [...out];
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

// ---------- Discovery ----------

type Candidate = { url: string; score: number; why: string };

function findCandidates(html: string, baseUrl: string): Candidate[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const found = new Map<string, Candidate>();

  const add = (href: string, label: string, why: string) => {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || SKIP_HOSTS.test(url.hostname)) return;
    url.hash = "";
    const text = `${label} ${url.pathname}`;
    let score = 0;
    if (/breakfast|brunch/i.test(text)) score += 3;
    if (/menu/i.test(text)) score += 2;
    if (/food|eat|all-?day/i.test(text)) score += 1;
    if (/\.pdf($|\?)/i.test(url.pathname)) score += 1;
    if (url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) score += 2;
    if (/drink|wine|cocktail|bar|christmas|kids|allergen|catering|platter|account|cart|checkout|gift|voucher|journal|blog/i.test(text)) score -= 2;
    if (score <= 1) return;
    const key = url.toString();
    if (key === base.toString()) return;
    const prev = found.get(key);
    if (!prev || prev.score < score) found.set(key, { url: key, score, why });
  };

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    const label = $(el).text().trim();
    if (MENU_WORDS.test(label) || MENU_WORDS.test(href) || /\.pdf($|\?)/i.test(href)) add(href, label, "link");
  });

  // schema.org hasMenu / Menu in JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    for (const m of raw.matchAll(/"hasMenu"\s*:\s*"([^"]+)"/g)) add(m[1], "menu", "json-ld");
  });

  // PDFs referenced from scripts rather than <a> tags (Wix, Showit and similar builders).
  for (const m of html.matchAll(/(?:https?:)?\/\/[^"'\s\\<>()]+?\.pdf\b|\/_files\/ugd\/[\w-]+\.pdf/gi)) {
    add(m[0].startsWith("//") ? `https:${m[0]}` : m[0], "", "raw-pdf");
  }

  return [...found.values()].sort((a, b) => b.score - a.score);
}

// ---------- Extraction ----------

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

const MenuSchema = z.object({
  menuFound: z.boolean().describe("true if the content contains an actual food menu with dish names"),
  hasBreakfast: z.boolean().describe("true if the menu has breakfast, brunch or all-day breakfast dishes"),
  servedUntil: z.string().describe('When breakfast is served until, e.g. "until 11:30", or empty string'),
  dishes: z.array(DishSchema).describe("Breakfast and brunch dishes only. Exclude drinks, lunch, dinner, desserts."),
});

type Menu = z.infer<typeof MenuSchema>;

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

async function extract(
  texts: { url: string; text: string }[],
  pdfs: { url: string; data: Buffer }[],
  images: { url: string; data: Buffer; mediaType: string }[],
): Promise<Menu> {
  const textBlock = texts
    .map((t) => `--- SOURCE: ${t.url} ---\n${t.text.slice(0, MAX_TEXT_CHARS)}`)
    .join("\n\n");
  const content: any[] = [{ type: "text", text: `Extract the breakfast menu from these café web pages.\n\n${textBlock}` }];
  for (const p of pdfs) {
    content.push({ type: "text", text: `--- PDF SOURCE: ${p.url} ---` });
    content.push({ type: "file", data: p.data, mediaType: "application/pdf" });
  }
  for (const img of images) {
    content.push({ type: "text", text: `--- IMAGE SOURCE: ${img.url} ---` });
    content.push({ type: "image", image: img.data, mediaType: img.mediaType });
  }
  const { output } = await generateText({
    model: anthropic(MODEL),
    system: INSTRUCTIONS,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: MenuSchema }),
    temperature: 0,
  });
  return output as Menu;
}

// ---------- Pipeline ----------

type Result = {
  placeId: string;
  name: string;
  website?: string;
  servesBreakfast?: boolean;
  status: Status;
  note?: string;
  sources: string[];
  likelyJsRendered?: boolean;
  menu?: Menu;
  counts?: { options: number; adaptable: number; eggMain: number; total: number };
  ms: number;
};

async function processPlace(p: Place): Promise<Result> {
  const t0 = Date.now();
  const base = {
    placeId: p.id,
    name: p.displayName?.text ?? p.id,
    website: p.websiteUri,
    servesBreakfast: p.servesBreakfast,
    sources: [] as string[],
  };
  const done = (r: Partial<Result> & { status: Status }): Result => ({ ...base, ...r, ms: Date.now() - t0 });

  if (!p.websiteUri) return done({ status: "no_website" });
  if (SKIP_HOSTS.test(new URL(p.websiteUri).hostname)) return done({ status: "no_website", note: "website is a social/delivery page" });

  let home: Fetched;
  try {
    home = await fetchHome(p.websiteUri);
  } catch (e) {
    return done({ status: "fetch_failed", note: String((e as Error).message) });
  }

  const texts: { url: string; text: string }[] = [];
  const pdfs: { url: string; data: Buffer; score: number }[] = [];
  const images: { url: string; data: Buffer; mediaType: string }[] = [];
  const seen = new Set<string>([home.url, p.websiteUri]);
  let likelyJsRendered = false;

  // Fetch one candidate; returns its HTML when it is a page, so the caller can look one hop deeper.
  const visit = async (c: Candidate): Promise<{ html: string; url: string; text: string } | null> => {
    if (seen.has(c.url)) return null;
    seen.add(c.url);
    try {
      const f = await fetchCapped(c.url, MAX_PDF_BYTES);
      if (isPdf(f)) {
        pdfs.push({ url: f.url, data: f.body, score: c.score });
        return null;
      }
      const html = f.body.toString("utf8");
      const text = htmlToText(html);
      if (text.length > 200) texts.push({ url: f.url, text });
      return { html, url: f.url, text };
    } catch {
      return null; // a dead candidate link is fine; others may work
    }
  };

  // Photos of a printed menu, used only when a menu page has almost no text and no PDF.
  const collectImages = async (html: string, url: string) => {
    for (const src of findMenuImages(html, url)) {
      if (images.length >= 4) return;
      if (seen.has(src)) continue;
      seen.add(src);
      try {
        const f = await fetchCapped(src, MAX_IMAGE_BYTES);
        if (isImage(f) && f.body.length >= MIN_IMAGE_BYTES) {
          images.push({ url: f.url, data: f.body, mediaType: f.contentType.split(";")[0] });
        }
      } catch {
        // skip unreadable images
      }
    }
  };

  if (isPdf(home)) {
    pdfs.push({ url: home.url, data: home.body, score: 5 });
  } else {
    const html = home.body.toString("utf8");
    const text = htmlToText(html);
    likelyJsRendered = text.length < 300;
    texts.push({ url: home.url, text });

    const hop1: { html: string; url: string; text: string }[] = [];
    for (const c of findCandidates(html, home.url).slice(0, 3)) {
      const page = await visit(c);
      if (page) hop1.push(page);
    }

    // Second hop: menu pages that only link to the real menu (PDFs, sub-pages).
    const hop2 = hop1
      .flatMap((pg) => findCandidates(pg.html, pg.url))
      .filter((c) => !seen.has(c.url))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const c of hop2) await visit(c);

    if (pdfs.length === 0) {
      for (const pg of hop1.filter((pg) => pg.text.length < 1500)) await collectImages(pg.html, pg.url);
    }
  }

  const bestPdfs = pdfs.sort((a, b) => b.score - a.score).slice(0, 3);
  const sources = [...texts.map((t) => t.url), ...bestPdfs.map((p) => p.url), ...images.map((i) => i.url)];
  const textChars = texts.reduce((n, t) => n + t.text.length, 0);
  if (bestPdfs.length === 0 && images.length === 0 && textChars < 300) {
    return done({ status: "no_menu_found", sources, likelyJsRendered, note: "almost no readable text" });
  }

  let menu: Menu;
  try {
    menu = await extract(texts, bestPdfs, images);
  } catch (e) {
    return done({ status: "fetch_failed", sources, likelyJsRendered, note: `LLM: ${(e as Error).message}` });
  }

  const counts = {
    options: menu.dishes.filter((d) => d.eggStatus === "no_egg" && d.substantial).length,
    adaptable: menu.dishes.filter((d) => d.eggStatus === "egg_component").length,
    eggMain: menu.dishes.filter((d) => d.eggStatus === "egg_main").length,
    total: menu.dishes.length,
  };
  const status: Status = !menu.menuFound ? "no_menu_found" : !menu.hasBreakfast || counts.total === 0 ? "no_breakfast" : "ok";
  return done({ status, sources, likelyJsRendered, menu, counts });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// ---------- Report ----------

function printResult(r: Result) {
  const head = `\n■ ${r.name}  [${r.status}]  ${r.website ?? "(no website)"}  ${(r.ms / 1000).toFixed(1)}s`;
  console.log(head);
  if (r.note) console.log(`  note: ${r.note}`);
  if (r.likelyJsRendered) console.log("  homepage looks client-side rendered");
  if (r.sources.length) console.log(`  sources: ${r.sources.join(", ")}`);
  if (!r.menu || !r.counts) return;
  const c = r.counts;
  console.log(`  ${c.options} egg-free options · ${c.adaptable} ask-without-egg · ${c.eggMain} egg dishes hidden · ${c.total} dishes${r.menu.servedUntil ? ` · ${r.menu.servedUntil}` : ""}`);
  const groups: [string, (d: Menu["dishes"][number]) => boolean][] = [
    ["  ✓ no egg", (d) => d.eggStatus === "no_egg"],
    ["  ~ ask without egg", (d) => d.eggStatus === "egg_component"],
    ["  ✗ egg dish (hidden)", (d) => d.eggStatus === "egg_main"],
  ];
  for (const [label, pred] of groups) {
    const ds = r.menu.dishes.filter(pred);
    if (!ds.length) continue;
    console.log(label);
    for (const d of ds) {
      const extra = [d.substantial ? "" : "minor", d.eggEvidence ? `“${d.eggEvidence}”` : ""].filter(Boolean).join(" ");
      console.log(`      ${d.name}${d.price ? ` (${d.price})` : ""}${extra ? `  — ${extra}` : ""}`);
    }
  }
}

function printSummary(results: Result[]) {
  const n = results.length;
  const by = (s: Status) => results.filter((r) => r.status === s).length;
  const ok = by("ok");
  console.log("\n================ SUMMARY ================");
  console.log(`cafés: ${n}   model: ${MODEL}`);
  for (const s of ["ok", "no_website", "no_menu_found", "no_breakfast", "fetch_failed"] as Status[]) {
    console.log(`  ${s.padEnd(14)} ${String(by(s)).padStart(3)}  ${((by(s) / n) * 100).toFixed(0)}%`);
  }
  console.log(`  js-rendered homepages: ${results.filter((r) => r.likelyJsRendered).length}`);
  console.log(`\ncoverage (usable menu): ${ok}/${n} = ${((ok / n) * 100).toFixed(0)}%   go/no-go bar: 60%`);
  console.log("\nranking (ok only):");
  results
    .filter((r) => r.status === "ok")
    .sort((a, b) => b.counts!.options - a.counts!.options || b.counts!.adaptable - a.counts!.adaptable)
    .forEach((r) => console.log(`  ${String(r.counts!.options).padStart(2)} options, ${r.counts!.adaptable} adaptable  ${r.name}`));
}

async function main() {
  const places = await searchPlaces();
  console.log(`Places returned ${places.length} cafés in Chiswick`);
  let done = 0;
  const results = await mapLimit(places, 3, async (p) => {
    const r = await processPlace(p);
    process.stderr.write(`  [${++done}/${places.length}] ${r.name}: ${r.status}\n`);
    return r;
  });
  results.forEach(printResult);
  printSummary(results);
  await mkdir("spike-output", { recursive: true });
  await writeFile("spike-output/results.json", JSON.stringify(results, null, 2));
  console.log("\nfull results: spike-output/results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
