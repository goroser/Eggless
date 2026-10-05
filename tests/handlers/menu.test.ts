import { beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { APICallError, NoObjectGeneratedError } from "ai";
import { handleMenu } from "@/lib/handlers/menu";
import { claimMenu, saveMenu } from "@/lib/db/menus";
import { signToken } from "@/lib/token";
import type { Db } from "@/lib/db/client";
import type { ExtractFn } from "@/lib/menu/extract";
import type { ExtractedMenu, MenuSummary } from "@/lib/types";
import { createTestDb } from "../db/testDb";
import { dish } from "../helpers/fixtures";
import { fixtureFetcher, html, words } from "../helpers/fetcher";

const SECRET = "m".repeat(32);
const NOW = new Date("2026-10-05T09:00:00.000Z");
const DAY = 86_400_000;
const SITE = "https://cafe.example/";

const token = (placeId = "p1", nowMs = NOW.getTime()) => signToken({ placeId, websiteUri: SITE }, SECRET, nowMs);

const site = () =>
  fixtureFetcher({
    [SITE]: html(`<a href="/breakfast">Breakfast</a><p>${words(60)}</p>`),
    "https://cafe.example/breakfast": html(`<h1>Breakfast</h1><p>${words(100)}</p>`),
  }).fetcher;

const menu: ExtractedMenu = {
  menuFound: true,
  hasBreakfast: true,
  servedUntil: "until 11:30",
  dishes: [dish("Porridge"), dish("Pork Sausage Brioche (NI)"), dish("Omelette", { eggStatus: "egg_main", eggEvidence: "Omelette" })],
};

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const deps = (extract: ExtractFn, fetcher = site()) => ({ db, fetcher, extract, tokenSecret: SECRET, model: "claude-haiku-4-5", now: NOW });

const row = async (placeId: string) =>
  ((await db.execute(sql`select * from menus where place_id = ${placeId}`)) as unknown as { rows: Record<string, unknown>[] }).rows[0];

describe("handleMenu", () => {
  test.each([{}, { token: "garbage" }, { token: token("p1", NOW.getTime() - 11 * 60_000) }])("rejects %j", async (body) => {
    const extract = vi.fn();
    expect(await handleMenu(body, deps(extract))).toEqual({ status: 401, json: { error: "invalid token" } });
    expect(extract).not.toHaveBeenCalled();
  });

  test("returns a fresh cached menu without extracting", async () => {
    await claimMenu(db, "p1", NOW);
    await saveMenu(
      db,
      "p1",
      { status: "ok", sourceUrl: SITE, sourceType: "html", sources: [], contentHash: null, servedUntil: null,
        dishes: [dish("Toast")], counts: { options: 1, adaptable: 0, eggMain: 0, total: 1 }, model: "m", promptVersion: 1 },
      NOW,
    );
    const extract = vi.fn();
    const r = await handleMenu({ token: token() }, deps(extract));
    expect(r.status).toBe(200);
    expect((r.json as MenuSummary).dishes.map((d) => d.name)).toEqual(["Toast"]);
    expect(extract).not.toHaveBeenCalled();
  });

  test("extracts, filters, counts and stores a new menu", async () => {
    const extract = vi.fn(async () => menu);
    const r = await handleMenu({ token: token() }, deps(extract));
    expect(r.status).toBe(200);
    const s = r.json as MenuSummary;
    expect(s.status).toBe("ok");
    expect(s.dishes.map((d) => d.name)).toEqual(["Porridge", "Omelette"]);
    expect(s.counts).toEqual({ options: 1, adaptable: 0, eggMain: 1, total: 2 });
    expect(s.servedUntil).toBe("until 11:30");
    expect(s.sourceUrl).toBe("https://cafe.example/breakfast");
    const saved = await row("p1");
    expect(saved).toMatchObject({ model: "claude-haiku-4-5", prompt_version: 1, source_type: "html" });
    expect(saved.sources).toEqual([SITE, "https://cafe.example/breakfast"]);
    expect(String(saved.content_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(String(saved.expires_at)).getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  test("a site with no menu is stored for 7 days without calling the model", async () => {
    const extract = vi.fn();
    const fetcher = fixtureFetcher({ [SITE]: html("<p>Hello</p>") }).fetcher;
    const r = await handleMenu({ token: token() }, deps(extract, fetcher));
    expect((r.json as MenuSummary).status).toBe("no_menu_found");
    expect(extract).not.toHaveBeenCalled();
    expect(new Date(String((await row("p1")).expires_at)).getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  test("two concurrent requests extract once; the other gets 202", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const extract = vi.fn(async () => {
      await gate;
      return menu;
    });
    const a = handleMenu({ token: token() }, deps(extract));
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    const b = await handleMenu({ token: token() }, deps(extract));
    expect(b).toEqual({ status: 202, json: { status: "pending" } });
    release();
    expect((await a).status).toBe(200);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  test("a menu the model cannot read is stored as fetch_failed", async () => {
    const extract = vi.fn(async () => {
      throw new NoObjectGeneratedError({
        message: "No object generated",
        response: { id: "r", timestamp: new Date(), modelId: "m" },
        usage: {} as never,
        finishReason: "stop" as never,
      });
    });
    const r = await handleMenu({ token: token() }, deps(extract));
    expect(r.status).toBe(200);
    expect((r.json as MenuSummary).status).toBe("fetch_failed");
    expect(new Date(String((await row("p1")).expires_at)).getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  test("an overloaded model releases the claim and asks for a retry", async () => {
    const extract = vi.fn(async () => {
      throw new APICallError({ message: "overloaded", url: "u", requestBodyValues: {}, statusCode: 529, isRetryable: true });
    });
    const r = await handleMenu({ token: token() }, deps(extract));
    expect(r).toEqual({ status: 503, json: { error: "temporary", retry: true } });
    expect(await claimMenu(db, "p1", NOW)).toBe(true);
  });

  test.each([
    ["a bad API key", new APICallError({ message: "invalid x-api-key", url: "u", requestBodyValues: {}, statusCode: 401 })],
    ["low credit", new APICallError({ message: "Your credit balance is too low", url: "u", requestBodyValues: {}, statusCode: 400 })],
    ["an unknown error", new Error("socket hang up")],
  ])("%s releases the claim instead of caching a failure", async (_label, err) => {
    const extract = vi.fn(async () => {
      throw err;
    });
    const r = await handleMenu({ token: token() }, deps(extract));
    expect(r).toEqual({ status: 503, json: { error: "temporary", retry: true } });
    expect(await claimMenu(db, "p1", NOW)).toBe(true);
  });

  test("an extraction past its time budget is stored as fetch_failed", async () => {
    const extract: ExtractFn = (_s, opts) =>
      new Promise((_resolve, reject) => opts?.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal!.reason)));
    const r = await handleMenu({ token: token() }, { ...deps(extract), budgets: { collectMs: 5_000, extractMs: 50 } });
    expect(r.status).toBe(200);
    expect((r.json as MenuSummary).status).toBe("fetch_failed");
  });

  test("the extractor receives an abort signal", async () => {
    const extract = vi.fn<ExtractFn>(async () => menu);
    await handleMenu({ token: token() }, deps(extract));
    expect(extract.mock.calls[0][1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test("a database error while saving releases the claim and asks for a retry", async () => {
    await db.execute(sql`drop table dishes`);
    const r = await handleMenu({ token: token() }, deps(vi.fn(async () => menu)));
    expect(r).toEqual({ status: 503, json: { error: "temporary", retry: true } });
    expect(await claimMenu(db, "p1", NOW)).toBe(true);
  });
});
