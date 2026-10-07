CREATE TABLE "photo_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dishes" ADD COLUMN "name_ru" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dishes" ADD COLUMN "description_ru" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "site_domain" text;--> statement-breakpoint
CREATE INDEX "menus_site_domain_idx" ON "menus" USING btree ("site_domain");