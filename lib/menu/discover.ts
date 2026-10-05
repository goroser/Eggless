import * as cheerio from "cheerio";
import { isSkippedHost } from "@/lib/menu/fetch";

export type Candidate = { url: string; score: number; why: "link" | "json-ld" | "raw-pdf" };

const MENU_WORDS = /menu|breakfast|brunch|food|eat|all-day|all_day|allday/i;
const NEGATIVE_WORDS =
  /drink|wine|cocktail|bar|christmas|kids|allergen|catering|platter|account|cart|checkout|gift|voucher|journal|blog/i;
const PDF_PATH = /\.pdf($|\?)/i;
// PDFs referenced from scripts rather than <a> tags (Wix, Showit and similar builders).
const RAW_PDF = /(?:https?:)?\/\/[^"'\s\\<>()]+?\.pdf\b|\/_files\/ugd\/[\w-]+\.pdf/gi;

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

const bareHost = (host: string) => host.replace(/^www\./, "");

export function findCandidates(html: string, baseUrl: string): Candidate[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const found = new Map<string, Candidate>();

  const add = (href: string, label: string, why: Candidate["why"]) => {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || isSkippedHost(url.hostname)) return;
    url.hash = "";
    const text = `${label} ${url.pathname}`;
    let score = 0;
    if (/breakfast|brunch/i.test(text)) score += 3;
    if (/menu/i.test(text)) score += 2;
    if (/food|eat|all-?day/i.test(text)) score += 1;
    if (PDF_PATH.test(url.pathname)) score += 1;
    if (bareHost(url.hostname) === bareHost(base.hostname)) score += 2;
    if (NEGATIVE_WORDS.test(text)) score -= 2;
    if (score <= 1) return;
    const key = url.toString();
    if (key === base.toString()) return;
    const prev = found.get(key);
    if (!prev || prev.score < score) found.set(key, { url: key, score, why });
  };

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    const label = $(el).text().trim();
    if (MENU_WORDS.test(label) || MENU_WORDS.test(href) || PDF_PATH.test(href)) add(href, label, "link");
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    for (const m of $(el).text().matchAll(/"hasMenu"\s*:\s*"([^"]+)"/g)) add(m[1], "menu", "json-ld");
  });

  for (const m of html.matchAll(RAW_PDF)) {
    const href = m[0].startsWith("//") ? `https:${m[0]}` : m[0];
    add(href, "", "raw-pdf"); // an equal-scoring <a> link found earlier is kept
  }

  return [...found.values()].sort((a, b) => b.score - a.score);
}

// Images on a menu page whose text is too thin to be the menu itself.
export function findMenuImages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("img").each((_, el) => {
    const raw = $(el).attr("data-src") || $(el).attr("src") || "";
    const alt = $(el).attr("alt") ?? "";
    if (!raw || raw.startsWith("data:")) return;
    if (/logo|icon|avatar|favicon|sprite|\.svg/i.test(`${raw} ${alt}`)) return;
    let url: string;
    try {
      url = new URL(raw, baseUrl).toString();
    } catch {
      return;
    }
    // Wix serves thumbnails like .../media/<id>~mv2.jpg/v1/fill/w_170,...; take the original.
    out.add(url.replace(/(static\.wixstatic\.com\/media\/[^/]+)\/v1\/.*$/, "$1"));
  });
  return [...out];
}
