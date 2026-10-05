import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fetched, MenuFetcher } from "@/lib/types";

// ASCII only: some hosts (Wix) answer 403 to a non-ASCII User-Agent.
export const USER_AGENT = "EgglessBot/0.1 (personal project; one fetch per cafe)";

export const SKIP_HOSTS =
  /deliveroo|ubereats|just-eat|justeat|instagram|facebook|tiktok|twitter|x\.com|opentable|resy|sevenrooms|exploretock|tock\.com|bookatable|designmynight|thefork|google\./i;

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export const isPdf = (f: Fetched) => f.contentType.includes("pdf") || /\.pdf($|\?)/i.test(f.url);
export const isImage = (f: Fetched) => /^image\/(jpeg|png|webp|gif)/.test(f.contentType);

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind !== 6) return true; // not an address we understand: refuse
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
}

export function createFetcher(deps: {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
} = {}): MenuFetcher {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;

  const checkTarget = async (url: URL) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported protocol ${url.protocol}`);
    if (SKIP_HOSTS.test(url.hostname)) throw new Error(`skipped host ${url.hostname}`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await lookup(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error(`private address for ${url.hostname}`);
    }
  };

  return async (input, maxBytes) => {
    let url = new URL(input);
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    for (let hop = 0; ; hop++) {
      await checkTarget(url);
      const res = await fetchImpl(url.toString(), {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,image/*,*/*" },
        redirect: "manual",
        signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
        url = new URL(res.headers.get("location")!, url);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { url: url.toString(), contentType: res.headers.get("content-type") ?? "", body: await readCapped(res, maxBytes) };
    }
  };
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// A stale deep link on Google (e.g. a closed store page) falls back to the
// first path segment (a locale section like /uk/), then the site root.
export async function fetchHome(fetcher: MenuFetcher, url: string): Promise<Fetched> {
  try {
    return await fetcher(url, MAX_HTML_BYTES);
  } catch (e) {
    if (!/HTTP 4\d\d/.test((e as Error).message)) throw e;
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0];
    const fallbacks = [first ? new URL(`/${first}/`, u).toString() : null, new URL("/", u).toString()];
    for (const fb of fallbacks) {
      if (!fb || fb === url) continue;
      try {
        return await fetcher(fb, MAX_HTML_BYTES);
      } catch {
        // try the next one
      }
    }
    throw e;
  }
}
