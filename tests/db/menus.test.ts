import { beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { claimMenu, expiryFor, getCachedMenus, releaseClaim, saveMenu, sharedDomains, type SaveInput } from "@/lib/db/menus";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "./testDb";
import { dish } from "../helpers/fixtures";

const T0 = new Date("2026-10-05T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 86_400_000;

const okInput = (names: string[]): SaveInput => ({
  status: "ok",
  sourceUrl: "https://cafe.example/menu",
  sourceType: "html",
  sources: ["https://cafe.example/", "https://cafe.example/menu"],
  contentHash: "abc",
  servedUntil: "until 11:30",
  dishes: names.map((n) => dish(n)),
  counts: { options: names.length, adaptable: 0, eggMain: 0, total: names.length },
  model: "claude-haiku-4-5",
  promptVersion: 2,
  imageUrl: null,
  siteDomain: "cafe.example",
});

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("expiryFor", () => {
  test.each([
    ["ok", 30],
    ["no_breakfast", 30],
    ["no_menu_found", 7],
    ["fetch_failed", 7],
  ] as const)("%s expires after %i days", (status, days) => {
    expect(expiryFor(status, T0).getTime()).toBe(T0.getTime() + days * DAY);
  });
});

describe("claimMenu", () => {
  test("claims an unknown place and leaves a pending row", async () => {
    expect(await claimMenu(db, "p1", T0)).toBe(true);
    const rows = await db.execute(sql`select status, claimed_at from menus where place_id = 'p1'`);
    const row = (rows as unknown as { rows: { status: string; claimed_at: Date | string }[] }).rows[0];
    expect(row.status).toBe("pending");
    expect(new Date(row.claimed_at).getTime()).toBe(T0.getTime());
  });

  test("a fresh pending claim blocks another, a stale one does not", async () => {
    await claimMenu(db, "p1", T0);
    expect(await claimMenu(db, "p1", at(30_000))).toBe(false);
    expect(await claimMenu(db, "p1", at(3 * 60_000))).toBe(true);
  });

  test("a saved menu blocks claims until it expires", async () => {
    await claimMenu(db, "p1", T0);
    await saveMenu(db, "p1", okInput(["Porridge"]), T0);
    expect(await claimMenu(db, "p1", at(29 * DAY))).toBe(false);
    expect(await claimMenu(db, "p1", at(31 * DAY))).toBe(true);
  });

  test("of two concurrent claims exactly one wins", async () => {
    const results = await Promise.all([claimMenu(db, "p1", T0), claimMenu(db, "p1", T0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("saveMenu", () => {
  test("replaces earlier dishes and returns them in order", async () => {
    await claimMenu(db, "p1", T0);
    await saveMenu(db, "p1", okInput(["A", "B", "C"]), T0);
    const summary = await saveMenu(db, "p1", okInput(["Y", "Z"]), at(1000));
    expect(summary.dishes.map((d) => d.name)).toEqual(["Y", "Z"]);
    expect(summary.extractedAt).toBe(at(1000).toISOString());
    expect(summary).toMatchObject({ status: "ok", servedUntil: "until 11:30", sourceUrl: "https://cafe.example/menu" });
    expect(summary.counts).toEqual({ options: 2, adaptable: 0, eggMain: 0, total: 2 });
    const cached = await getCachedMenus(db, ["p1"], at(2000));
    expect(cached.get("p1")?.dishes.map((d) => d.name)).toEqual(["Y", "Z"]);
  });

  test("saves a failure without dishes or counts", async () => {
    await claimMenu(db, "p1", T0);
    const s = await saveMenu(
      db,
      "p1",
      { ...okInput([]), status: "fetch_failed", counts: null, sourceUrl: null, sourceType: null },
      T0,
    );
    expect(s).toMatchObject({ status: "fetch_failed", counts: null, dishes: [] });
  });
});

describe("getCachedMenus", () => {
  test("omits pending and expired rows", async () => {
    await claimMenu(db, "pending", T0);
    await claimMenu(db, "fresh", T0);
    await saveMenu(db, "fresh", okInput(["Porridge"]), T0);
    await claimMenu(db, "old", at(-40 * DAY));
    await saveMenu(db, "old", okInput(["Toast"]), at(-40 * DAY));
    const cached = await getCachedMenus(db, ["pending", "fresh", "old", "unknown"], T0);
    expect([...cached.keys()]).toEqual(["fresh"]);
  });

  test("returns an empty map for no IDs", async () => {
    expect((await getCachedMenus(db, [], T0)).size).toBe(0);
  });
});

describe("releaseClaim", () => {
  test("deletes a pending row but not a saved one", async () => {
    await claimMenu(db, "pending", T0);
    await claimMenu(db, "saved", T0);
    await saveMenu(db, "saved", okInput(["Porridge"]), T0);
    await releaseClaim(db, "pending");
    await releaseClaim(db, "saved");
    expect(await claimMenu(db, "pending", at(1000))).toBe(true);
    expect((await getCachedMenus(db, ["saved"], at(1000))).has("saved")).toBe(true);
  });
});

describe("Phase 2 columns", () => {
  test("Russian names, descriptions and the image round-trip", async () => {
    await claimMenu(db, "p1", T0);
    await saveMenu(
      db,
      "p1",
      { ...okInput([]), dishes: [dish("Porridge", { nameRu: "Овсянка", description: "oats", descriptionRu: "овсяные хлопья" })], imageUrl: "https://cafe.example/room.jpg" },
      T0,
    );
    const m = (await getCachedMenus(db, ["p1"], at(1000))).get("p1")!;
    expect(m.dishes[0]).toMatchObject({ nameRu: "Овсянка", descriptionRu: "овсяные хлопья" });
    expect(m.imageUrl).toBe("https://cafe.example/room.jpg");
  });

  test("a dish written without the new columns reads back untranslated", async () => {
    await claimMenu(db, "p1", T0);
    await saveMenu(db, "p1", okInput([]), T0);
    await db.execute(
      sql`insert into dishes (place_id, position, section, name, description, price, egg_status, egg_evidence, substantial)
          values ('p1', 0, 'Breakfast', 'Toast', '', '', 'no_egg', '', true)`,
    );
    const m = (await getCachedMenus(db, ["p1"], at(1000))).get("p1")!;
    expect(m.dishes[0]).toMatchObject({ name: "Toast", nameRu: "", descriptionRu: "" });
  });

  test("sharedDomains finds domains used by two or more places", async () => {
    for (const [id, domain] of [["a1", "a.com"], ["a2", "a.com"], ["b1", "b.com"]]) {
      await claimMenu(db, id, T0);
      await saveMenu(db, id, { ...okInput(["X"]), siteDomain: domain }, T0);
    }
    expect(await sharedDomains(db, ["a.com", "b.com", "c.com"])).toEqual(new Set(["a.com"]));
    expect(await sharedDomains(db, [])).toEqual(new Set());
  });
});

