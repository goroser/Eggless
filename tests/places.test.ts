import { describe, expect, test, vi } from "vitest";
import { createPlacesClient, nearToRect, PlacesError, PlacesQuotaError, rectTooLarge } from "@/lib/places";

const CHISWICK = { low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } };

describe("createPlacesClient", () => {
  test("sends the field mask, query and rectangle", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json({ places: [{ id: "p1" }] }));
    const search = createPlacesClient("KEY", fetchImpl as typeof fetch);
    expect(await search(CHISWICK)).toEqual([{ id: "p1" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Goog-Api-Key")).toBe("KEY");
    expect(headers.get("X-Goog-FieldMask")).toBe(
      "places.id,places.displayName,places.location,places.googleMapsUri,places.primaryType,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.websiteUri,places.servesBreakfast",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: "breakfast cafe",
      pageSize: 20,
      locationRestriction: {
        rectangle: { low: { latitude: 51.486, longitude: -0.275 }, high: { latitude: 51.498, longitude: -0.245 } },
      },
    });
  });

  test("429 is a quota error", async () => {
    const search = createPlacesClient("KEY", (async () => new Response("quota", { status: 429 })) as typeof fetch);
    await expect(search(CHISWICK)).rejects.toBeInstanceOf(PlacesQuotaError);
  });

  test("other errors are PlacesError", async () => {
    const search = createPlacesClient("KEY", (async () => new Response("bad", { status: 400 })) as typeof fetch);
    await expect(search(CHISWICK)).rejects.toBeInstanceOf(PlacesError);
  });

  test("no places is an empty list", async () => {
    const search = createPlacesClient("KEY", (async () => Response.json({})) as typeof fetch);
    expect(await search(CHISWICK)).toEqual([]);
  });
});

describe("areas", () => {
  test("nearToRect is about 1 km each way", () => {
    const r = nearToRect({ lat: 51.49, lng: -0.26 });
    expect(r.low.lat).toBeCloseTo(51.481, 6);
    expect(r.low.lng).toBeCloseTo(-0.2745, 6);
    expect(r.high.lat).toBeCloseTo(51.499, 6);
    expect(r.high.lng).toBeCloseTo(-0.2455, 6);
  });

  test("rectTooLarge", () => {
    expect(rectTooLarge(CHISWICK)).toBe(false);
    expect(rectTooLarge({ low: { lat: 51.4, lng: -0.26 }, high: { lat: 51.5, lng: -0.25 } })).toBe(true);
    expect(rectTooLarge({ low: { lat: 51.49, lng: -0.4 }, high: { lat: 51.5, lng: -0.3 } })).toBe(true);
  });
});
