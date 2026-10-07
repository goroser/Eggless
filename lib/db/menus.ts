import { and, asc, countDistinct, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { dishes, menus } from "@/lib/db/schema";
import type { Counts, Dish, EggStatus, MenuStatus, MenuSummary } from "@/lib/types";

export type SaveInput = {
  status: Exclude<MenuStatus, "pending" | "no_website">;
  sourceUrl: string | null;
  sourceType: "html" | "pdf" | "image" | null;
  sources: string[];
  contentHash: string | null;
  servedUntil: string | null;
  dishes: Dish[];
  counts: Counts | null;
  model: string | null;
  promptVersion: number | null;
  imageUrl: string | null;
  siteDomain: string | null;
};

const DAY_MS = 86_400_000;
const LEASE_MS = 2 * 60_000;

export function expiryFor(status: SaveInput["status"], now: Date): Date {
  const days = status === "ok" || status === "no_breakfast" ? 30 : 7;
  return new Date(now.getTime() + days * DAY_MS);
}

type MenuRow = typeof menus.$inferSelect;
type DishRow = typeof dishes.$inferSelect;

function toSummary(m: MenuRow, ds: DishRow[]): MenuSummary {
  const hasCounts = m.optionsCount !== null && m.totalCount !== null;
  return {
    status: m.status as MenuStatus,
    counts: hasCounts
      ? { options: m.optionsCount!, adaptable: m.adaptableCount ?? 0, eggMain: m.eggCount ?? 0, total: m.totalCount! }
      : null,
    servedUntil: m.servedUntil,
    sourceUrl: m.sourceUrl,
    extractedAt: m.extractedAt ? new Date(m.extractedAt).toISOString() : null,
    imageUrl: m.imageUrl,
    dishes: ds.map((d) => ({
      section: d.section,
      name: d.name,
      nameRu: d.nameRu,
      description: d.description,
      descriptionRu: d.descriptionRu,
      price: d.price,
      eggStatus: d.eggStatus as EggStatus,
      eggEvidence: d.eggEvidence,
      substantial: d.substantial,
    })),
  };
}

export async function getCachedMenus(db: Db, placeIds: string[], now: Date): Promise<Map<string, MenuSummary>> {
  const out = new Map<string, MenuSummary>();
  if (placeIds.length === 0) return out;
  const rows = await db
    .select()
    .from(menus)
    .where(and(inArray(menus.placeId, placeIds), ne(menus.status, "pending"), gt(menus.expiresAt, now)));
  if (rows.length === 0) return out;
  const dishRows = await db
    .select()
    .from(dishes)
    .where(inArray(dishes.placeId, rows.map((r) => r.placeId)))
    .orderBy(asc(dishes.placeId), asc(dishes.position));
  for (const r of rows) out.set(r.placeId, toSummary(r, dishRows.filter((d) => d.placeId === r.placeId)));
  return out;
}

// Claims a café for extraction. Succeeds for a new café, an expired menu, or a pending claim
// older than the lease; fails while another request holds a fresh claim or the menu is current.
export async function claimMenu(db: Db, placeId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  const rows = await db
    .insert(menus)
    .values({ placeId, status: "pending", claimedAt: now, sources: [] })
    .onConflictDoUpdate({
      target: menus.placeId,
      set: { status: "pending", claimedAt: now },
      setWhere: sql`(${menus.status} <> 'pending' and ${menus.expiresAt} < ${now.toISOString()})
        or (${menus.status} = 'pending' and ${menus.claimedAt} < ${staleBefore.toISOString()})`,
    })
    .returning({ placeId: menus.placeId });
  return rows.length > 0;
}

export async function saveMenu(db: Db, placeId: string, input: SaveInput, now: Date): Promise<MenuSummary> {
  const values = {
    status: input.status,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    sources: input.sources,
    contentHash: input.contentHash,
    servedUntil: input.servedUntil,
    optionsCount: input.counts?.options ?? null,
    adaptableCount: input.counts?.adaptable ?? null,
    eggCount: input.counts?.eggMain ?? null,
    totalCount: input.counts?.total ?? null,
    model: input.model,
    promptVersion: input.promptVersion,
    imageUrl: input.imageUrl,
    siteDomain: input.siteDomain,
    claimedAt: null,
    extractedAt: now,
    expiresAt: expiryFor(input.status, now),
  };
  return db.transaction(async (tx) => {
    const [menu] = await tx
      .insert(menus)
      .values({ placeId, ...values })
      .onConflictDoUpdate({ target: menus.placeId, set: values })
      .returning();
    await tx.delete(dishes).where(eq(dishes.placeId, placeId));
    const inserted = input.dishes.length
      ? await tx
          .insert(dishes)
          .values(input.dishes.map((d, position) => ({ placeId, position, ...d })))
          .returning()
      : [];
    return toSummary(menu, inserted.sort((a, b) => a.position - b.position));
  });
}

export async function releaseClaim(db: Db, placeId: string): Promise<void> {
  await db.delete(menus).where(and(eq(menus.placeId, placeId), eq(menus.status, "pending")));
}

// Website domains already stored for two or more different cafés: a sign of a chain.
export async function sharedDomains(db: Db, domains: string[]): Promise<Set<string>> {
  if (domains.length === 0) return new Set();
  const rows = await db
    .select({ domain: menus.siteDomain })
    .from(menus)
    .where(inArray(menus.siteDomain, domains))
    .groupBy(menus.siteDomain)
    .having(gte(countDistinct(menus.placeId), 2));
  return new Set(rows.map((r) => r.domain!).filter(Boolean));
}
