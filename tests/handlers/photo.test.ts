import { beforeEach, describe, expect, test, vi } from "vitest";
import { handlePhoto, PHOTO_REDIRECT_MAX_AGE } from "@/lib/handlers/photo";
import { incrementPhotoUsage } from "@/lib/db/photoUsage";
import { signPhotoRef } from "@/lib/token";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "../db/testDb";

const SECRET = "p".repeat(32);
const NOW = new Date("2026-10-07T23:30:00.000Z");
const NAME = "places/ChIJabc/photos/AUc7xyz";
const URI = "https://lh3.googleusercontent.com/p/AF1Qip=s400";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const run = (params: Record<string, string>, cap = 100) => {
  const lookup = vi.fn(async (_name: string, _w: number) => URI);
  const result = handlePhoto(new URLSearchParams(params), { db, lookup, tokenSecret: SECRET, cap, now: NOW });
  return { lookup, result };
};
const ref = (nowMs = NOW.getTime()) => signPhotoRef(NAME, SECRET, nowMs);

describe("handlePhoto", () => {
  test.each([{}, { t: "garbage" }, { t: signPhotoRef(NAME, SECRET, NOW.getTime() - 11 * 60_000) }])("bad token %j → 404", async (p) => {
    const { result, lookup } = run(p as Record<string, string>);
    expect(await result).toEqual({ status: 404 });
    expect(lookup).not.toHaveBeenCalled();
  });

  test.each([
    ["50", 200],
    ["5000", 800],
    [undefined, 400],
    ["abc", 400],
  ])("width %s → %i", async (w, expected) => {
    const { result, lookup } = run(w === undefined ? { t: ref() } : { t: ref(), w });
    await result;
    expect(lookup).toHaveBeenCalledWith(NAME, expected);
  });

  test("redirects to the photo without exposing a key", async () => {
    const r = await run({ t: ref() }).result;
    expect(r).toEqual({ status: 302, location: URI });
    expect(r.location).not.toMatch(/key=/i);
  });

  test("refuses over the daily cap without calling Google", async () => {
    await incrementPhotoUsage(db, "2026-10-07");
    await incrementPhotoUsage(db, "2026-10-07");
    const { result, lookup } = run({ t: ref() }, 2);
    expect(await result).toEqual({ status: 429 });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("counts usage on the UTC day", async () => {
    await run({ t: ref() }).result;
    expect(await incrementPhotoUsage(db, "2026-10-07")).toBe(2);
    expect(await incrementPhotoUsage(db, "2026-10-08")).toBe(1);
  });

  test("a failing Google lookup is a 502", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await handlePhoto(new URLSearchParams({ t: ref() }), { db, lookup, tokenSecret: SECRET, cap: 100, now: NOW })).toEqual({
      status: 502,
    });
  });
});

describe("incrementPhotoUsage", () => {
  test("concurrent increments both count", async () => {
    const counts = await Promise.all([incrementPhotoUsage(db, "2026-10-07"), incrementPhotoUsage(db, "2026-10-07")]);
    expect(counts.sort()).toEqual([1, 2]);
  });
});

test("the photo redirect is cached no longer than a photo ref lives", () => {
  expect(PHOTO_REDIRECT_MAX_AGE).toBeLessThanOrEqual(600);
});

