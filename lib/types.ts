export type Fetched = { url: string; contentType: string; body: Buffer };

// Fetches a URL with a byte cap. Rejects on non-2xx, oversize bodies and unsafe targets.
export type MenuFetcher = (url: string, maxBytes: number) => Promise<Fetched>;

export type EggStatus = "egg_main" | "egg_component" | "no_egg";

export type Dish = {
  section: string;
  name: string;
  nameRu: string; // "" when not translated
  description: string;
  descriptionRu: string;
  price: string;
  eggStatus: EggStatus;
  eggEvidence: string;
  substantial: boolean;
};

export type ExtractedMenu = { menuFound: boolean; hasBreakfast: boolean; servedUntil: string; dishes: Dish[] };

export type Counts = { options: number; adaptable: number; eggMain: number; total: number };

export type MenuStatus = "ok" | "no_website" | "no_menu_found" | "no_breakfast" | "fetch_failed" | "pending";

export type MenuSummary = {
  status: MenuStatus;
  counts: Counts | null;
  servedUntil: string | null;
  sourceUrl: string | null;
  extractedAt: string | null;
  imageUrl: string | null;
  dishes: Dish[];
};

export type LatLng = { lat: number; lng: number };
export type Rect = { low: LatLng; high: LatLng };

export type CafeResult = {
  placeId: string;
  name: string;
  location: LatLng;
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  googleMapsUri: string;
  menu: MenuSummary | null;
  token?: string;
  chain: boolean;
  photos: PhotoRef[];
};

// A Google photo the browser may request through /api/photo; never stored.
export type PhotoRef = { ref: string; attribution: { name: string; uri: string } };
