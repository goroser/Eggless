import { createHmac, timingSafeEqual } from "node:crypto";

// Carries the café's website from /api/search to /api/menu, so the server neither
// stores Google data nor trusts a URL sent by the browser.
export type TokenPayload = { placeId: string; websiteUri: string };

const TTL_MS = 10 * 60_000;

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signToken(p: TokenPayload, secret: string, nowMs = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ placeId: p.placeId, websiteUri: p.websiteUri, exp: nowMs + TTL_MS })).toString(
    "base64url",
  );
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(t: string, secret: string, nowMs = Date.now()): TokenPayload | null {
  const parts = t.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.placeId !== "string" || typeof p.websiteUri !== "string" || typeof p.exp !== "number") return null;
    if (p.exp < nowMs) return null;
    return { placeId: p.placeId, websiteUri: p.websiteUri };
  } catch {
    return null;
  }
}
