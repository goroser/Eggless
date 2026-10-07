import * as cheerio from "cheerio";
import { isSkippedHost } from "@/lib/menu/fetch";

const NOT_A_PHOTO = /logo|icon|favicon|avatar|sprite|placeholder|default/i;
const MIN_DECLARED_WIDTH = 400;
// Instagram and Facebook image servers sign their URLs, which expire, so they cannot be shown later.
const EXPIRING_IMAGE_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

// The café's own share image (what a link preview would show), if it looks like a real photo.
export function findShareImage(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const declaredWidth = Number($('meta[property="og:image:width"]').attr("content"));
  const candidates: { raw: string; width?: number }[] = [];

  const og = $('meta[property="og:image"]').attr("content");
  if (og) candidates.push({ raw: og, width: Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : undefined });
  const tw = $('meta[name="twitter:image"]').attr("content");
  if (tw) candidates.push({ raw: tw });
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const image = JSON.parse($(el).text())?.image;
      const first = Array.isArray(image) ? image[0] : image;
      const url = typeof first === "string" ? first : first?.url;
      if (typeof url === "string") candidates.push({ raw: url });
    } catch {
      // malformed JSON-LD is common; ignore it
    }
  });

  for (const c of candidates) {
    let url: URL;
    try {
      url = new URL(c.raw.trim(), baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || isSkippedHost(url.hostname) || EXPIRING_IMAGE_HOSTS.test(url.hostname)) continue;
    if (NOT_A_PHOTO.test(url.pathname) || /\.svg$/i.test(url.pathname)) continue;
    if (c.width !== undefined && c.width < MIN_DECLARED_WIDTH) continue;
    return url.toString();
  }
  return null;
}
