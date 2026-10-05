import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { getCachedMenus } from "@/lib/db/menus";
import { rankCafes } from "@/lib/menu/score";
import { nearToRect, PlacesError, PlacesQuotaError, rectTooLarge, type Place, type SearchPlacesFn } from "@/lib/places";
import { signToken } from "@/lib/token";
import type { CafeResult, MenuSummary, Rect } from "@/lib/types";

export type SearchDeps = { db: Db; searchPlaces: SearchPlacesFn; tokenSecret: string; now: Date };

const LatLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const BodySchema = z.union([
  z.object({ rect: z.object({ low: LatLngSchema, high: LatLngSchema }) }),
  z.object({ near: LatLngSchema }),
]);

const NO_WEBSITE: MenuSummary = {
  status: "no_website",
  counts: null,
  servedUntil: null,
  sourceUrl: null,
  extractedAt: null,
  dishes: [],
};

function toCafe(p: Place & { location: NonNullable<Place["location"]> }): CafeResult {
  const cafe: CafeResult = {
    placeId: p.id,
    name: p.displayName?.text ?? "Unnamed café",
    location: { lat: p.location.latitude, lng: p.location.longitude },
    googleMapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    menu: null,
  };
  if (p.rating !== undefined) cafe.rating = p.rating;
  if (p.userRatingCount !== undefined) cafe.userRatingCount = p.userRatingCount;
  if (p.currentOpeningHours?.openNow !== undefined) cafe.openNow = p.currentOpeningHours.openNow;
  return cafe;
}

export async function handleSearch(body: unknown, deps: SearchDeps): Promise<{ status: number; json: unknown }> {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: "invalid request" } };
  const rect: Rect = "rect" in parsed.data ? parsed.data.rect : nearToRect(parsed.data.near);
  if (rectTooLarge(rect)) return { status: 400, json: { error: "Zoom in to search a smaller area" } };

  let places: Place[];
  try {
    places = await deps.searchPlaces(rect);
  } catch (e) {
    if (e instanceof PlacesQuotaError) return { status: 503, json: { error: "Daily search limit reached, try again tomorrow" } };
    if (e instanceof PlacesError) return { status: 502, json: { error: "Google search failed, try again" } };
    throw e;
  }

  const usable = places.filter(
    (p): p is Place & { location: NonNullable<Place["location"]> } => p.servesBreakfast !== false && !!p.location,
  );
  const cached = await getCachedMenus(deps.db, usable.map((p) => p.id), deps.now);

  const cafes = usable.map((p) => {
    const cafe = toCafe(p);
    const menu = cached.get(p.id);
    if (menu) cafe.menu = menu;
    else if (!p.websiteUri) cafe.menu = NO_WEBSITE;
    else cafe.token = signToken({ placeId: p.id, websiteUri: p.websiteUri }, deps.tokenSecret, deps.now.getTime());
    return cafe;
  });

  return { status: 200, json: { cafes: rankCafes(cafes) } };
}
