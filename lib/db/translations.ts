import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { dishes } from "@/lib/db/schema";
import type { TranslateFn } from "@/lib/menu/translate";

type Untranslated = { placeId: string; dishes: { id: number; name: string; description: string }[] };

export async function listUntranslated(db: Db): Promise<Untranslated[]> {
  const rows = await db
    .select({ id: dishes.id, placeId: dishes.placeId, name: dishes.name, description: dishes.description })
    .from(dishes)
    .where(eq(dishes.nameRu, ""))
    .orderBy(asc(dishes.placeId), asc(dishes.position));
  const byPlace = new Map<string, Untranslated>();
  for (const r of rows) {
    const p = byPlace.get(r.placeId) ?? { placeId: r.placeId, dishes: [] };
    p.dishes.push({ id: r.id, name: r.name, description: r.description });
    byPlace.set(r.placeId, p);
  }
  return [...byPlace.values()];
}

// Updates by dish id; rows that vanished (the menu was re-read meanwhile) are simply not counted.
export async function saveTranslations(db: Db, rows: { id: number; nameRu: string; descriptionRu: string }[]): Promise<number> {
  return db.transaction(async (tx) => {
    let updated = 0;
    for (const r of rows) {
      const res = await tx
        .update(dishes)
        .set({ nameRu: r.nameRu, descriptionRu: r.descriptionRu })
        .where(eq(dishes.id, r.id))
        .returning({ id: dishes.id });
      updated += res.length;
    }
    return updated;
  });
}

export async function runBackfill(
  db: Db,
  translate: TranslateFn,
  log: (line: string) => void = () => {},
): Promise<{ places: number; dishes: number; failed: string[] }> {
  const result = { places: 0, dishes: 0, failed: [] as string[] };
  for (const place of await listUntranslated(db)) {
    try {
      const out = await translate(place.dishes.map((d) => ({ name: d.name, description: d.description })));
      const updated = await saveTranslations(
        db,
        place.dishes.map((d, i) => ({ id: d.id, nameRu: out[i].nameRu, descriptionRu: out[i].descriptionRu })),
      );
      if (updated > 0) result.places++;
      result.dishes += updated;
      log(`  ${place.placeId}: ${updated} dishes`);
    } catch (e) {
      result.failed.push(place.placeId);
      log(`  ${place.placeId}: failed (${(e as Error).message})`);
    }
  }
  return result;
}
