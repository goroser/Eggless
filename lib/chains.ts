// Host of a URL, lower case, without "www."; null for anything that is not a URL.
export function siteDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
