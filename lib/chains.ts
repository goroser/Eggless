// Host of a URL, lower case, without "www."; null for anything that is not a URL.
export function siteDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

import { isSkippedHost } from "@/lib/menu/fetch";

// UK café chains, matched as whole words at the start of the normalised name. Easy to extend.
export const CHAIN_NAMES = [
  "gails", "caffe nero", "cafe nero", "costa", "pret", "starbucks", "joe the juice", "le pain quotidien", "paul bakery",
  "watchhouse",
  "black sheep coffee", "grind", "ole steen", "leon", "itsu", "wasabi", "coco di mama", "puccino", "notes coffee",
  "watch house", "department of coffee", "blank street", "origin coffee", "harris hoole", "greggs",
  "the breakfast club", "megans",
];

// Too generic as a prefix ("Paul Rothe & Son", "Notes from a Kitchen"), so only the bare brand name counts.
const EXACT_CHAIN_NAMES = ["paul", "notes"];

// Link-in-bio, site-builder and ordering platforms: many unrelated cafés share these domains.
const PLATFORM_DOMAINS =
  /(^|\.)(linktr\.ee|sites\.google\.com|toasttab\.com|square\.site|squareup\.com|wixsite\.com|business\.site|squarespace\.com|carrd\.co|beacons\.ai|bio\.link|lnk\.bio|wordpress\.com|order\.online|flipdish\.com|slerp\.com)$/i;

// A domain that says nothing about ownership: a social, delivery, booking or hosting platform.
export function isPlatformDomain(domain: string): boolean {
  return isSkippedHost(domain) || PLATFORM_DOMAINS.test(domain);
}

export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’&+]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STORE_FINDER_PATH = /\/(stores?|locations?|shops?|branches|our-cafes|cafes|find-us)\/[^/]+/i;

export function isChain(input: { name: string; websiteUri?: string; sharedDomain: boolean }): boolean {
  if (input.sharedDomain) return true;
  const name = normaliseName(input.name);
  if (CHAIN_NAMES.some((c) => name === c || name.startsWith(`${c} `))) return true;
  if (EXACT_CHAIN_NAMES.includes(name)) return true;
  if (!input.websiteUri) return false;
  try {
    const url = new URL(input.websiteUri);
    return !isPlatformDomain(url.hostname) && STORE_FINDER_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
