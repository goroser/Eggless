import type { LatLng, Rect } from "@/lib/types";

export type Place = {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean };
  websiteUri?: string;
  servesBreakfast?: boolean;
};

export class PlacesQuotaError extends Error {}
export class PlacesError extends Error {}

export type SearchPlacesFn = (rect: Rect) => Promise<Place[]>;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.googleMapsUri",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours.openNow",
  "places.websiteUri",
  "places.servesBreakfast",
].join(",");

const toLatLng = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

export function createPlacesClient(apiKey: string, fetchImpl: typeof fetch = fetch): SearchPlacesFn {
  return async (rect) => {
    const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({
        textQuery: "breakfast cafe",
        pageSize: 20,
        locationRestriction: { rectangle: { low: toLatLng(rect.low), high: toLatLng(rect.high) } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) throw new PlacesQuotaError(await res.text());
    if (!res.ok) throw new PlacesError(`Places search failed: HTTP ${res.status}`);
    const json = (await res.json()) as { places?: Place[] };
    return json.places ?? [];
  };
}

// About 1 km each way around a point in London.
export function nearToRect(p: LatLng): Rect {
  return { low: { lat: p.lat - 0.009, lng: p.lng - 0.0145 }, high: { lat: p.lat + 0.009, lng: p.lng + 0.0145 } };
}

// About 5 km on a side, so one search cannot cover all of London.
export function rectTooLarge(r: Rect): boolean {
  return Math.abs(r.high.lat - r.low.lat) > 0.045 || Math.abs(r.high.lng - r.low.lng) > 0.072;
}
