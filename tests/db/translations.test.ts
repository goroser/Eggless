import { beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { claimMenu, saveMenu, type SaveInput } from "@/lib/db/menus";
import { listUntranslated, runBackfill, saveTranslations } from "@/lib/db/translations";
import type { Db } from "@/lib/db/client";
import type { TranslateFn } from "@/lib/menu/translate";
import { createTestDb } from "./testDb";
import { dish } from "../helpers/fixtures";

const T0 = new Date("2026-10-07T09:00:00.000Z");
const input = (dishes: ReturnType<typeof dish>[]): SaveInput => ({
  status: "ok", sourceUrl: null, sourceType: "html", sources: [], contentHash: null, servedUntil: null, dishes,
  counts: { options: dishes.length, adaptable: 0, eggMain: 0, total: dishes.length }, model: "m", promptVersion: 1,
  imageUrl: null, siteDomain: null,
});

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await claimMenu(db, "a", T0);
  await saveMenu(db, "a", input([dish("Porridge", { description: "oats" }), dish("Toast", { nameRu: "Тост" })]), T0);
  await claimMenu(db, "b", T0);
  await saveMenu(db, "b", input([dish("Pancakes")]), T0);
});

const stub: TranslateFn = async (items) => items.map((i) => ({ nameRu: `RU ${i.name}`, descriptionRu: i.description ? `RU ${i.description}` : "" }));

const names = async () =>
  ((await db.execute(sql`select name, name_ru from dishes order by place_id, position`)) as unknown as { rows: { name: string; name_ru: string }[] }).rows;

describe("listUntranslated", () => {
  test("groups untranslated dishes by place, in menu order", async () => {
    const list = await listUntranslated(db);
    expect(list.map((p) => [p.placeId, p.dishes.map((d) => d.name)])).toEqual([
      ["a", ["Porridge"]],
      ["b", ["Pancakes"]],
    ]);
    expect(list[0].dishes[0].description).toBe("oats");
  });
});

describe("runBackfill", () => {
  test("translates every untranslated dish", async () => {
    const r = await runBackfill(db, stub);
    expect(r).toEqual({ places: 2, dishes: 2, failed: [] });
    expect(await names()).toEqual([
      { name: "Porridge", name_ru: "RU Porridge" },
      { name: "Toast", name_ru: "Тост" },
      { name: "Pancakes", name_ru: "RU Pancakes" },
    ]);
  });

  test("a failing place is reported and the others still translate; a rerun finishes it", async () => {
    const flaky: TranslateFn = async (items) => {
      if (items.some((i) => i.name === "Pancakes")) throw new Error("overloaded");
      return stub(items);
    };
    const first = await runBackfill(db, flaky, vi.fn());
    expect(first).toEqual({ places: 1, dishes: 1, failed: ["b"] });
    const second = await runBackfill(db, stub);
    expect(second).toEqual({ places: 1, dishes: 1, failed: [] });
  });

  test("dishes replaced mid-run are skipped without an error", async () => {
    const racing: TranslateFn = async (items) => {
      if (items.some((i) => i.name === "Porridge")) {
        await saveMenu(db, "a", input([dish("New porridge")]), T0); // re-extraction replaces the rows
      }
      return stub(items);
    };
    const r = await runBackfill(db, racing);
    expect(r.failed).toEqual([]);
    expect(r.dishes).toBe(1); // only Pancakes landed
    expect((await listUntranslated(db)).map((p) => p.dishes.map((d) => d.name))).toEqual([["New porridge"]]);
  });

  test("saveTranslations reports how many rows it updated", async () => {
    expect(await saveTranslations(db, [{ id: 999_999, nameRu: "x", descriptionRu: "" }])).toBe(0);
  });
});
