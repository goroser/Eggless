CREATE TABLE "dishes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"position" integer NOT NULL,
	"section" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price" text NOT NULL,
	"egg_status" text NOT NULL,
	"egg_evidence" text NOT NULL,
	"substantial" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"place_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"source_url" text,
	"source_type" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text,
	"served_until" text,
	"options_count" integer,
	"adaptable_count" integer,
	"egg_count" integer,
	"total_count" integer,
	"model" text,
	"prompt_version" integer,
	"claimed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_place_id_menus_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."menus"("place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dishes_place_idx" ON "dishes" USING btree ("place_id","position");