import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { claimMenu, getCachedMenus, releaseClaim, saveMenu, type SaveInput } from "@/lib/db/menus";
import { collectSources, type Sources } from "@/lib/menu/collect";
import { isCafeAttributableLlmError, PROMPT_VERSION, type ExtractFn } from "@/lib/menu/extract";
import { filterDishes } from "@/lib/menu/filter";
import { countDishes, menuStatus } from "@/lib/menu/score";
import { verifyToken } from "@/lib/token";
import type { ExtractedMenu, MenuFetcher } from "@/lib/types";

// Collection plus extraction must finish inside the route's 60 s limit. A fetch started just
// before the collect deadline can run 8 s past it.
const DEFAULT_BUDGETS = { collectMs: 20_000, extractMs: 25_000 };

export type MenuDeps = {
  db: Db;
  fetcher: MenuFetcher;
  extract: ExtractFn;
  tokenSecret: string;
  model: string;
  now: Date;
  budgets?: { collectMs: number; extractMs: number };
};

const BodySchema = z.object({ token: z.string() });

const RETRY = { status: 503, json: { error: "temporary", retry: true } } as const;

function contentHash({ texts, pdfs, images }: Sources): string {
  const h = createHash("sha256");
  for (const t of texts) h.update(t.text);
  for (const p of pdfs) h.update(p.data);
  for (const i of images) h.update(i.data);
  return h.digest("hex");
}

const failure = (status: "no_menu_found" | "fetch_failed", sources: string[]): SaveInput => ({
  status,
  sourceUrl: null,
  sourceType: null,
  sources,
  contentHash: null,
  servedUntil: null,
  dishes: [],
  counts: null,
  model: null,
  promptVersion: null,
});

export async function handleMenu(body: unknown, deps: MenuDeps): Promise<{ status: number; json: unknown }> {
  const parsed = BodySchema.safeParse(body);
  const payload = parsed.success ? verifyToken(parsed.data.token, deps.tokenSecret, deps.now.getTime()) : null;
  if (!payload) return { status: 401, json: { error: "invalid token" } };
  const { placeId, websiteUri } = payload;
  const budgets = deps.budgets ?? DEFAULT_BUDGETS;

  const cached = (await getCachedMenus(deps.db, [placeId], deps.now)).get(placeId);
  if (cached) return { status: 200, json: cached };

  if (!(await claimMenu(deps.db, placeId, deps.now))) return { status: 202, json: { status: "pending" } };

  try {
    const collected = await collectSources(deps.fetcher, websiteUri, { deadline: Date.now() + budgets.collectMs });
    if (collected.kind === "none") {
      return { status: 200, json: await saveMenu(deps.db, placeId, failure(collected.status, collected.sourceUrls), deps.now) };
    }

    const signal = AbortSignal.timeout(budgets.extractMs);
    let extracted: ExtractedMenu;
    try {
      extracted = await deps.extract(collected.sources, { abortSignal: signal });
    } catch (e) {
      if (!signal.aborted && !isCafeAttributableLlmError(e)) throw e;
      // Too slow or unreadable: the café's content is the problem, so remember it for a week.
      console.error(`menu extraction failed for ${placeId}:`, e);
      return { status: 200, json: await saveMenu(deps.db, placeId, failure("fetch_failed", collected.sourceUrls), deps.now) };
    }

    const dishes = filterDishes(extracted.dishes);
    const counts = countDishes(dishes);
    const summary = await saveMenu(
      deps.db,
      placeId,
      {
        status: menuStatus(extracted, counts),
        sourceUrl: collected.primaryUrl,
        sourceType: collected.sourceType,
        sources: collected.sourceUrls,
        contentHash: contentHash(collected.sources),
        servedUntil: extracted.servedUntil || null,
        dishes,
        counts,
        model: deps.model,
        promptVersion: PROMPT_VERSION,
      },
      deps.now,
    );
    return { status: 200, json: summary };
  } catch (e) {
    // Ours, not the café's (model outage, bad key, no credit, database error): let a later request try again.
    console.error(`menu request failed for ${placeId}:`, e);
    await releaseClaim(deps.db, placeId).catch(() => {});
    return RETRY;
  }
}
