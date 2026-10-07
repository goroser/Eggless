import { getDb } from "@/lib/db/client";
import { handlePhoto, PHOTO_REDIRECT_MAX_AGE } from "@/lib/handlers/photo";
import { createPhotoLookup } from "@/lib/photos";

export async function GET(req: Request) {
  if (!process.env.MENU_TOKEN_SECRET || !process.env.GOOGLE_PLACES_API_KEY) return new Response(null, { status: 500 });
  const { status, location } = await handlePhoto(new URL(req.url).searchParams, {
    db: getDb(),
    lookup: createPhotoLookup(process.env.GOOGLE_PLACES_API_KEY),
    tokenSecret: process.env.MENU_TOKEN_SECRET,
    cap: Number(process.env.PHOTO_DAILY_CAP) || 100,
    now: new Date(),
  });
  if (status === 302 && location) {
    return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": `private, max-age=${PHOTO_REDIRECT_MAX_AGE}` } });
  }
  return new Response(null, { status });
}
