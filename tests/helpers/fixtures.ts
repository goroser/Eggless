import type { CafeResult, Counts, Dish, MenuSummary } from "@/lib/types";

export const dish = (name: string, over: Partial<Dish> = {}): Dish => ({
  section: "Breakfast",
  name,
  nameRu: "",
  description: "",
  descriptionRu: "",
  price: "",
  eggStatus: "no_egg",
  eggEvidence: "",
  substantial: true,
  ...over,
});

export const summary = (over: Partial<MenuSummary> = {}): MenuSummary => ({
  status: "ok",
  counts: { options: 0, adaptable: 0, eggMain: 0, total: 0 },
  servedUntil: null,
  sourceUrl: "https://cafe.example/menu",
  extractedAt: "2026-10-05T09:00:00.000Z",
  imageUrl: null,
  dishes: [],
  ...over,
});

export const cafe = (id: string, counts: Partial<Counts> | null, over: Partial<CafeResult> = {}): CafeResult => ({
  placeId: id,
  name: id,
  location: { lat: 51.49, lng: -0.26 },
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
  menu: counts ? summary({ counts: { options: 0, adaptable: 0, eggMain: 0, total: 1, ...counts } }) : null,
  ...over,
});
