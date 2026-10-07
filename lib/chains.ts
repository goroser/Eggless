// Host of a URL, lower case, without "www."; null for anything that is not a URL.
export function siteDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// UK café chains, matched as whole words at the start of the normalised name. Easy to extend.
export const CHAIN_NAMES = [
  "gails", "caffe nero", "cafe nero", "costa", "pret", "starbucks", "joe the juice", "le pain quotidien", "paul",
  "black sheep coffee", "grind", "ole steen", "leon", "itsu", "wasabi", "coco di mama", "puccino", "notes coffee",
  "watch house", "department of coffee", "blank street", "origin coffee", "harris hoole", "greggs",
  "the breakfast club", "megans",
];

export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STORE_FINDER_PATH = /\/(stores?|locations?|shops?|branches|our-cafes|cafes|find-us)\/[^/]+/i;

export function isChain(input: { name: string; websiteUri?: string; sharedDomain: boolean }): boolean {
  if (input.sharedDomain) return true;
  const name = normaliseName(input.name);
  if (CHAIN_NAMES.some((c) => name === c || name.startsWith(`${c} `))) return true;
  if (!input.websiteUri) return false;
  try {
    return STORE_FINDER_PATH.test(new URL(input.websiteUri).pathname);
  } catch {
    return false;
  }
}
