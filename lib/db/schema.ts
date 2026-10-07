import { bigserial, boolean, date, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Only the Google place ID comes from Google; everything else is read from café websites.
export const menus = pgTable(
  "menus",
  {
  placeId: text("place_id").primaryKey(),
  status: text("status").notNull(), // pending | ok | no_menu_found | no_breakfast | fetch_failed
  sourceUrl: text("source_url"),
  sourceType: text("source_type"), // html | pdf | image
  sources: jsonb("sources").$type<string[]>().notNull().default([]),
  contentHash: text("content_hash"),
  servedUntil: text("served_until"),
  optionsCount: integer("options_count"),
  adaptableCount: integer("adaptable_count"),
  eggCount: integer("egg_count"),
  totalCount: integer("total_count"),
  model: text("model"),
  promptVersion: integer("prompt_version"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  imageUrl: text("image_url"), // the café website's own share image, found by our crawl
  siteDomain: text("site_domain"), // host of the café's home page as fetched, "www." removed
  },
  (t) => [index("menus_site_domain_idx").on(t.siteDomain)],
);

export const dishes = pgTable(
  "dishes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => menus.placeId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    section: text("section").notNull(),
    name: text("name").notNull(),
    nameRu: text("name_ru").notNull().default(""),
    description: text("description").notNull(),
    descriptionRu: text("description_ru").notNull().default(""),
    price: text("price").notNull(),
    eggStatus: text("egg_status").notNull(), // egg_main | egg_component | no_egg
    eggEvidence: text("egg_evidence").notNull(),
    substantial: boolean("substantial").notNull(),
  },
  (t) => [index("dishes_place_idx").on(t.placeId, t.position)],
);

// Google photo requests per UTC day, for the app-side cap.
export const photoUsage = pgTable("photo_usage", {
  day: date("day").primaryKey(),
  count: integer("count").notNull(),
});
