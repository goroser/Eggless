import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import type { Fetched, MenuFetcher } from "@/lib/types";

// ASCII only: some hosts (Wix) answer 403 to a non-ASCII User-Agent.
export const USER_AGENT = "EgglessBot/0.1 (personal project; one fetch per cafe)";

// Delivery, social and booking sites: never a café's own menu. Matched on whole domain labels.
const SKIP_HOSTS =
  /(^|\.)(deliveroo|ubereats|just-eat|justeat|instagram|facebook|tiktok|twitter|opentable|resy|sevenrooms|exploretock|tock|bookatable|designmynight|thefork|google)\.[a-z.]+$|(^|\.)x\.com$/i;

export const isSkippedHost = (hostname: string) => SKIP_HOSTS.test(hostname.replace(/\.$/, ""));

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export const isPdf = (f: Fetched) => f.contentType.includes("pdf") || /\.pdf($|\?)/i.test(f.url);
export const isImage = (f: Fetched) => /^image\/(jpeg|png|webp|gif)/.test(f.contentType);

// Anything that is not plain public unicast is refused, including IPv4 hidden inside
// IPv6 forms (::ffff:7f00:1, ::7f00:1, 64:ff9b::/96, 2002::/16) and reserved ranges.
export function isPrivateAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  const addr = ipaddr.process(ip);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).parts.slice(0, 6).every((p) => p === 0)) return true;
  return addr.range() !== "unicast";
}

type Resolved = { address: string; family: number };
type LookupCallback = (err: Error | null, address?: string | Resolved[], family?: number) => void;

// Used by the socket itself, so the address that was checked is the address connected to
// (no DNS-rebinding window between the check and the connection).
export function createSafeLookup(resolve: (host: string) => Promise<Resolved[]>) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    resolve(hostname).then(
      (records) => {
        if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
          callback(new Error(`private address for ${hostname}`));
        } else if (options.all) {
          callback(null, records);
        } else {
          callback(null, records[0].address, records[0].family);
        }
      },
      (e: Error) => callback(e),
    );
  };
}

const resolveAll = async (host: string): Promise<Resolved[]> => dnsLookup(host, { all: true });

const safeAgent = new Agent({ connect: { lookup: createSafeLookup(resolveAll) as never } });
const safeFetch = ((url: string, init?: RequestInit) =>
  undiciFetch(url, { ...(init as object), dispatcher: safeAgent } as never)) as unknown as typeof fetch;

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
}

export function createFetcher(deps: {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
} = {}): MenuFetcher {
  const fetchImpl = deps.fetchImpl ?? safeFetch;
  const lookup = deps.lookup ?? defaultLookup;

  const checkTarget = async (url: URL) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported protocol ${url.protocol}`);
    if (isSkippedHost(url.hostname)) throw new Error(`skipped host ${url.hostname}`);
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
