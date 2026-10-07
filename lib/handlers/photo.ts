import type { Db } from "@/lib/db/client";
import { incrementPhotoUsage } from "@/lib/db/photoUsage";
import { verifyPhotoRef } from "@/lib/token";

export type PhotoDeps = {
  db: Db;
  lookup: (name: string, width: number) => Promise<string>;
  tokenSecret: string;
  cap: number;
  now: Date;
};

const clampWidth = (raw: string | null) => {
  const w = Number(raw);
  if (!raw || !Number.isFinite(w)) return 400;
  return Math.min(800, Math.max(200, Math.round(w)));
};

export async function handlePhoto(params: URLSearchParams, deps: PhotoDeps): Promise<{ status: number; location?: string }> {
  const name = verifyPhotoRef(params.get("t") ?? "", deps.tokenSecret, deps.now.getTime());
  if (!name) return { status: 404 };
  const used = await incrementPhotoUsage(deps.db, deps.now.toISOString().slice(0, 10));
  if (used > deps.cap) return { status: 429 };
  try {
    return { status: 302, location: await deps.lookup(name, clampWidth(params.get("w"))) };
  } catch (e) {
    console.error("photo lookup failed:", e);
    return { status: 502 };
  }
}
