import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleSearch } from "@/lib/handlers/search";
import { claimMenu, saveMenu } from "@/lib/db/menus";
import { PlacesError, PlacesQuotaError, type Place } from "@/lib/places";
import { verifyPhotoRef, verifyToken } from "@/lib/token";
import type { Db } from "@/lib/db/client";
import type { CafeResult } from "@/lib/types";
import { createTestDb } from "../db/testDb";
import { dish } from "../helpers/fixtures";

const SECRET = "t".repeat(32);
const NOW = new Date("2026-10-05T09:00:00.000Z");
const RECT = { low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } };

const place = (id: string, over: Partial<Place> = {}): Place => ({
  id,
  displayName: { text: `Cafe ${id}` },
  location: { latitude: 51.49, longitude: -0.26 },
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
  rating: 4.5,
  userRatingCount: 100,
  currentOpeningHours: { openNow: true },
  websiteUri: `https://${id}.example/`,
  ...over,
});

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const run = (body: unknown, places: Place[] | Error = []) => {
  const searchPlaces = vi.fn(async () => {
    if (places instanceof Error) throw places;
    return places;
  });
  return { searchPlaces, result: handleSearch(body, { db, searchPlaces, tokenSecret: SECRET, now: NOW }) };
};

const cafes = async (r: Promise<{ status: number; json: unknown }>) => ((await r).json as { cafes: CafeResult[] }).cafes;

describe("handleSearch", () => {
  test.each([undefined, {}, { rect: { low: { lat: "x" } } }, { near: { lat: 1 } }])("rejects body %j", async (body) => {
    expect((await run(body).result).status).toBe(400);
  });

  test("rejects a rectangle over about 5 km", async () => {
    const { result, searchPlaces } = run({ rect: { low: { lat: 51.4, lng: -0.3 }, high: { lat: 51.5, lng: -0.2 } } });
    expect((await result).status).toBe(400);
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  test("converts near to a rectangle", async () => {
    const { result, searchPlaces } = run({ near: { lat: 51.49, lng: -0.26 } });
    expect((await result).status).toBe(200);
    const rect = (searchPlaces.mock.calls[0] as unknown as [typeof RECT])[0];
    expect(rect.low.lat).toBeCloseTo(51.481, 6);
    expect(rect.high.lng).toBeCloseTo(-0.2455, 6);
  });

  test("drops places that do not serve breakfast, keeps unknown", async () => {
    const out = await cafes(run({ rect: RECT }, [place("a", { servesBreakfast: false }), place("b"), place("c", { servesBreakfast: true })]).result);
    expect(out.map((c) => c.placeId).sort()).toEqual(["b", "c"]);
  });

  test("cached places get their menu, uncached get a token", async () => {
    await claimMenu(db, "cached", NOW);
    await saveMenu(
      db,
      "cached",
      {
        status: "ok", sourceUrl: "https://cached.example/menu", sourceType: "html", sources: [], contentHash: null,
        servedUntil: null, dishes: [dish("Porridge")], counts: { options: 1, adaptable: 0, eggMain: 0, total: 1 },
        model: "m", promptVersion: 1, imageUrl: null, siteDomain: null,
      },
      NOW,
    );
    const out = await cafes(run({ rect: RECT }, [place("cached"), place("fresh")]).result);
    const cached = out.find((c) => c.placeId === "cached")!;
    const fresh = out.find((c) => c.placeId === "fresh")!;
    expect(cached.menu?.dishes.map((d) => d.name)).toEqual(["Porridge"]);
    expect(cached.token).toBeUndefined();
    expect(fresh.menu).toBeNull();
    expect(verifyToken(fresh.token!, SECRET, NOW.getTime())).toEqual({ placeId: "fresh", websiteUri: "https://fresh.example/" });
  });

  test("a place without a website is no_website and not stored", async () => {
    const out = await cafes(run({ rect: RECT }, [place("noweb", { websiteUri: undefined })]).result);
    expect(out[0].menu?.status).toBe("no_website");
    expect(out[0].token).toBeUndefined();
    const again = await cafes(run({ rect: RECT }, [place("noweb")]).result);
    expect(again[0].menu).toBeNull();
  });

  test("sparse places omit missing fields", async () => {
    const out = await cafes(
      run({ rect: RECT }, [place("s", { rating: undefined, userRatingCount: undefined, currentOpeningHours: undefined })]).result,
    );
    expect(out[0]).not.toHaveProperty("rating");
    expect(out[0]).not.toHaveProperty("userRatingCount");
    expect(out[0]).not.toHaveProperty("openNow");
    expect(out[0]).toMatchObject({ placeId: "s", name: "Cafe s", location: { lat: 51.49, lng: -0.26 } });
  });

  test("zero places is an empty list", async () => {
    const r = await run({ rect: RECT }, []).result;
    expect(r).toEqual({ status: 200, json: { cafes: [] } });
  });

  test("results are ranked", async () => {
    const out = await cafes(run({ rect: RECT }, [place("low", { rating: 3 }), place("high", { rating: 4.9 })]).result);
    expect(out.map((c) => c.placeId)).toEqual(["high", "low"]);
  });

  test("quota exhausted is 503 with the copy", async () => {
    expect(await run({ rect: RECT }, new PlacesQuotaError("q")).result).toEqual({
      status: 503,
      json: { error: "Лимит поиска на сегодня исчерпан, попробуйте завтра" },
    });
  });

  test("other Places failures are 502", async () => {
    expect((await run({ rect: RECT }, new PlacesError("boom")).result).status).toBe(502);
  });

  describe("chains and photos", () => {
    test("a listed name is a chain", async () => {
      const out = await cafes(run({ rect: RECT }, [place("g", { displayName: { text: "GAIL's Bakery Chiswick" } }), place("l")]).result);
      expect(Object.fromEntries(out.map((c) => [c.placeId, c.chain]))).toEqual({ g: true, l: false });
    });

    test("two results sharing a website domain are chains", async () => {
      const out = await cafes(
        run({ rect: RECT }, [
          place("a", { websiteUri: "https://www.brunchco.example/chiswick" }),
          place("b", { websiteUri: "https://brunchco.example/ealing" }),
          place("c"),
        ]).result,
      );
      expect(Object.fromEntries(out.map((c) => [c.placeId, c.chain]))).toEqual({ a: true, b: true, c: false });
    });

    test("a domain already stored for two places makes a chain", async () => {
      for (const id of ["x1", "x2"]) {
        await claimMenu(db, id, NOW);
        await saveMenu(
          db,
          id,
          { status: "no_menu_found", sourceUrl: null, sourceType: null, sources: [], contentHash: null, servedUntil: null,
            dishes: [], counts: null, model: null, promptVersion: null, imageUrl: null, siteDomain: "smallchain.example" },
          NOW,
        );
      }
      const out = await cafes(run({ rect: RECT }, [place("new", { websiteUri: "https://smallchain.example/w4" })]).result);
      expect(out[0].chain).toBe(true);
    });

    test("up to two signed photo refs with attribution", async () => {
      const photos = [1, 2, 3].map((i) => ({
        name: `places/p/photos/ph${i}`,
        authorAttributions: [{ displayName: `Author ${i}`, uri: `https://maps.google.com/contrib/${i}` }],
      }));
      const out = await cafes(run({ rect: RECT }, [place("p", { photos }), place("q", { photos: [{ name: "places/q/photos/x" }] }), place("r")]).result);
      const byId = Object.fromEntries(out.map((c) => [c.placeId, c]));
      expect(byId.p.photos).toHaveLength(2);
      expect(verifyPhotoRef(byId.p.photos[0].ref, SECRET, NOW.getTime())).toBe("places/p/photos/ph1");
      expect(byId.p.photos[1].attribution).toEqual({ name: "Author 2", uri: "https://maps.google.com/contrib/2" });
      expect(byId.q.photos[0].attribution).toEqual({ name: "", uri: "" });
      expect(byId.r.photos).toEqual([]);
    });
  });

  test("cafés whose website is a social or link-in-bio page are not chains", async () => {
    const out = await cafes(
      run({ rect: RECT }, [
        place("i1", { websiteUri: "https://www.instagram.com/cafe_one/" }),
        place("i2", { websiteUri: "https://instagram.com/cafe_two" }),
        place("l1", { websiteUri: "https://linktr.ee/cafeone" }),
        place("l2", { websiteUri: "https://linktr.ee/cafetwo" }),
        place("s1", { websiteUri: "https://sites.google.com/view/cafeone" }),
        place("s2", { websiteUri: "https://sites.google.com/view/cafetwo" }),
      ]).result,
    );
    expect(out.every((c) => !c.chain)).toBe(true);
  });
});
