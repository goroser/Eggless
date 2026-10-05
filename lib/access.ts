import { timingSafeEqual } from "node:crypto";

export const COOKIE = "eggless_key";

export type GateDecision =
  | { action: "pass" }
  | { action: "set-cookie-redirect"; location: string }
  | { action: "deny"; api: boolean };

function matches(given: string | null | undefined, key: string): boolean {
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The whole site sits behind one shared secret: /?k=<key> stores it in a cookie.
export function gate(url: URL, cookie: string | undefined, accessKey: string): GateDecision {
  const api = url.pathname.startsWith("/api/");
  if (matches(cookie, accessKey)) return { action: "pass" };
  if (!api && matches(url.searchParams.get("k"), accessKey)) {
    const params = new URLSearchParams(url.searchParams);
    params.delete("k");
    const query = params.toString();
    return { action: "set-cookie-redirect", location: `${url.pathname}${query ? `?${query}` : ""}` };
  }
  return { action: "deny", api };
}
