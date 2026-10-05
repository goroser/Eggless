import { getDb } from "@/lib/db/client";
import { handleSearch } from "@/lib/handlers/search";
import { createPlacesClient } from "@/lib/places";

export async function POST(req: Request) {
  if (!process.env.MENU_TOKEN_SECRET || !process.env.GOOGLE_PLACES_API_KEY) {
    return Response.json({ error: "server is not configured" }, { status: 500 });
  }
  const body = await req.json().catch(() => undefined);
  const { status, json } = await handleSearch(body, {
    db: getDb(),
    searchPlaces: createPlacesClient(process.env.GOOGLE_PLACES_API_KEY),
    tokenSecret: process.env.MENU_TOKEN_SECRET,
    now: new Date(),
  });
  return Response.json(json, { status });
}
