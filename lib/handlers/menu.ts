import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { claimMenu, getCachedMenus, releaseClaim, saveMenu, type SaveInput } from "@/lib/db/menus";
import { collectSources, type Sources } from "@/lib/menu/collect";
import { isTransientLlmError, PROMPT_VERSION, type ExtractFn } from "@/lib/menu/extract";
import { filterDishes } from "@/lib/menu/filter";
import { countDishes, menuStatus } from "@/lib/menu/score";
import { verifyToken } from "@/lib/token";
import type { MenuFetcher } from "@/lib/types";

export type MenuDeps = { db: Db; fetcher: MenuFetcher; extract: ExtractFn; tokenSecret: string; model: string; now: Date };

const BodySchema = z.object({ token: z.string() });

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

  const cached = (await getCachedMenus(deps.db, [placeId], deps.now)).get(placeId);
  if (cached) return { status: 200, json: cached };

  if (!(await claimMenu(deps.db, placeId, deps.now))) return { status: 202, json: { status: "pending" } };

  const collected = await collectSources(deps.fetcher, websiteUri);
  if (collected.kind === "none") {
    return { status: 200, json: await saveMenu(deps.db, placeId, failure(collected.status, collected.sourceUrls), deps.now) };
  }

  try {
    const extracted = await deps.extract(collected.sources);
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
    if (isTransientLlmError(e)) {
      // Not the café's fault: let the next request try again instead of caching a failure for a week.
      await releaseClaim(deps.db, placeId);
      return { status: 503, json: { error: "temporary", retry: true } };
    }
    console.error(`menu extraction failed for ${placeId}:`, e);
    return { status: 200, json: await saveMenu(deps.db, placeId, failure("fetch_failed", collected.sourceUrls), deps.now) };
  }
}
