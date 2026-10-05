import { getDb } from "@/lib/db/client";
import { handleMenu } from "@/lib/handlers/menu";
import { createExtractor, DEFAULT_MODEL } from "@/lib/menu/extract";
import { createFetcher } from "@/lib/menu/fetch";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.MENU_TOKEN_SECRET) return Response.json({ error: "server is not configured" }, { status: 500 });
  const body = await req.json().catch(() => undefined);
  const { status, json } = await handleMenu(body, {
    db: getDb(),
    fetcher: createFetcher(),
    extract: createExtractor(),
    tokenSecret: process.env.MENU_TOKEN_SECRET,
    model: process.env.LLM_MODEL || DEFAULT_MODEL,
    now: new Date(),
  });
  return Response.json(json, { status });
}
