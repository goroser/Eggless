import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { getCachedMenus, sharedDomains } from "@/lib/db/menus";
import { isChain, isPlatformDomain, siteDomain } from "@/lib/chains";
import { rankCafes } from "@/lib/menu/score";
import { nearToRect, PlacesError, PlacesQuotaError, rectTooLarge, type Place, type SearchPlacesFn } from "@/lib/places";
import { signPhotoRef, signToken } from "@/lib/token";
import type { CafeResult, MenuSummary, PhotoRef, Rect } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

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
  imageUrl: null,
  dishes: [],
};

function photoRefs(p: Place, secret: string, nowMs: number): PhotoRef[] {
  return (p.photos ?? []).slice(0, 2).map((ph) => {
    const author = ph.authorAttributions?.[0];
    return { ref: signPhotoRef(ph.name, secret, nowMs), attribution: { name: author?.displayName ?? "", uri: author?.uri ?? "" } };
  });
}

function toCafe(p: Place & { location: NonNullable<Place["location"]> }, chain: boolean, photos: PhotoRef[]): CafeResult {
  const cafe: CafeResult = {
    placeId: p.id,
    name: p.displayName?.text ?? "—",
    location: { lat: p.location.latitude, lng: p.location.longitude },
    googleMapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    menu: null,
    chain,
    photos,
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
  if (rectTooLarge(rect)) return { status: 400, json: { error: ru.searchFailed } };

  let places: Place[];
  try {
    places = await deps.searchPlaces(rect);
  } catch (e) {
    if (e instanceof PlacesQuotaError) return { status: 503, json: { error: ru.quota } };
    if (e instanceof PlacesError) return { status: 502, json: { error: ru.searchFailed } };
    throw e;
  }

  const usable = places.filter(
    (p): p is Place & { location: NonNullable<Place["location"]> } => p.servesBreakfast !== false && !!p.location,
  );
  const cached = await getCachedMenus(deps.db, usable.map((p) => p.id), deps.now);

  // A website domain shared by two results here, or by two cafés already stored, marks a chain.
  const domains = usable.map((p) => {
    const d = p.websiteUri ? siteDomain(p.websiteUri) : null;
    return d && !isPlatformDomain(d) ? d : null;
  });
  const inSearch = new Map<string, number>();
  for (const d of domains) if (d) inSearch.set(d, (inSearch.get(d) ?? 0) + 1);
  const stored = await sharedDomains(deps.db, [...inSearch.keys()]);

  const cafes = usable.map((p, i) => {
    const d = domains[i];
    const chain = isChain({
      name: p.displayName?.text ?? "",
      websiteUri: p.websiteUri,
      sharedDomain: !!d && ((inSearch.get(d) ?? 0) >= 2 || stored.has(d)),
    });
    const cafe = toCafe(p, chain, photoRefs(p, deps.tokenSecret, deps.now.getTime()));
    const menu = cached.get(p.id);
    if (menu) cafe.menu = menu;
    else if (!p.websiteUri) cafe.menu = NO_WEBSITE;
    else cafe.token = signToken({ placeId: p.id, websiteUri: p.websiteUri }, deps.tokenSecret, deps.now.getTime());
    return cafe;
  });

  return { status: 200, json: { cafes: rankCafes(cafes) } };
}
