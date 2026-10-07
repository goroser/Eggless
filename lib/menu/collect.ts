import type { Fetched, MenuFetcher } from "@/lib/types";
import { fetchHome, isImage, isPdf, MAX_HTML_BYTES } from "@/lib/menu/fetch";
import { findCandidates, findMenuImages, htmlToText, type Candidate } from "@/lib/menu/discover";
import { findShareImage } from "@/lib/menu/image";
import { siteDomain } from "@/lib/chains";

export type Sources = {
  texts: { url: string; text: string }[];
  pdfs: { url: string; data: Buffer }[];
  images: { url: string; data: Buffer; mediaType: string }[];
};

export type CollectResult =
  | {
      kind: "sources";
      sources: Sources;
      sourceUrls: string[];
      primaryUrl: string;
      sourceType: "html" | "pdf" | "image";
      imageUrl: string | null;
      siteDomain: string | null;
    }
  | { kind: "none"; status: "no_menu_found" | "fetch_failed"; sourceUrls: string[]; note: string; siteDomain: string | null };

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_IMAGE_BYTES = 60 * 1024;
const MIN_SHARE_IMAGE_BYTES = 30 * 1024;
const MAX_PDFS = 3;
const MAX_TOTAL_PDF_BYTES = 20 * 1024 * 1024; // base64 inflates by a third; Anthropic caps requests at 32 MB
const MAX_IMAGES = 4;
const CANDIDATES_PER_HOP = 3;
const MIN_PAGE_TEXT = 200; // below this a page contributes no text
const THIN_MENU_PAGE = 1500; // below this a menu page's photos are read
const MIN_TOTAL_TEXT = 300;

type Page = { url: string; html: string; text: string };

// NUL bytes in the first kilobyte mean the "HTML" is really binary.
const looksBinary = (body: Buffer) => body.subarray(0, 1024).includes(0);

function readPage(f: Fetched): Page | null {
  if (looksBinary(f.body)) return null;
  const html = f.body.toString("utf8");
  return { url: f.url, html, text: htmlToText(html) };
}

export async function collectSources(
  baseFetcher: MenuFetcher,
  websiteUri: string,
  opts: { deadline?: number; now?: () => number } = {},
): Promise<CollectResult> {
  const now = opts.now ?? Date.now;
  const deadline = opts.deadline ?? Infinity;
  // Past the deadline no new fetch starts, so a slow site cannot run past the function's time limit.
  const fetcher: MenuFetcher = (url, maxBytes) =>
    now() >= deadline ? Promise.reject(new Error("time budget spent")) : baseFetcher(url, maxBytes);

  let home: Fetched;
  try {
    home = await fetchHome(fetcher, websiteUri);
  } catch (e) {
    return { kind: "none", status: "fetch_failed", sourceUrls: [], note: (e as Error).message, siteDomain: null };
  }

  const texts: Sources["texts"] = [];
  const pdfs: (Sources["pdfs"][number] & { score: number })[] = [];
  const images: Sources["images"] = [];
  const seen = new Set([websiteUri, home.url]);
  const menuPages: Page[] = [];
  let shareImage: string | null = null;

  // Fetch one candidate; returns the page when it is HTML so the caller can look one hop deeper.
  const visit = async (c: Candidate): Promise<Page | null> => {
    if (seen.has(c.url)) return null;
    seen.add(c.url);
    try {
      const f = await fetcher(c.url, MAX_PDF_BYTES);
      if (isPdf(f)) {
        pdfs.push({ url: f.url, data: f.body, score: c.score });
        return null;
      }
      if (f.body.length > MAX_HTML_BYTES) return null;
      const page = readPage(f);
      if (page && page.text.length > MIN_PAGE_TEXT) texts.push({ url: page.url, text: page.text });
      return page;
    } catch (e) {
      // A dead candidate link is fine (others may work); logged so a missing menu can be explained.
      console.warn(`menu candidate failed: ${c.url}: ${(e as Error).message}`);
      return null;
    }
  };

  if (isPdf(home)) {
    pdfs.push({ url: home.url, data: home.body, score: Infinity });
  } else {
    const page = readPage(home);
    if (page) {
      texts.push({ url: page.url, text: page.text });
      shareImage = findShareImage(page.html, page.url);
      for (const c of findCandidates(page.html, page.url).slice(0, CANDIDATES_PER_HOP)) {
        const p = await visit(c);
        if (p) menuPages.push(p);
      }
      // Second hop: menu pages that only link to the real menu (PDFs, sub-pages).
      const hop2 = menuPages
        .flatMap((p) => findCandidates(p.html, p.url))
        .filter((c) => !seen.has(c.url))
        .sort((a, b) => b.score - a.score)
        .slice(0, CANDIDATES_PER_HOP);
      for (const c of hop2) await visit(c);
    }
  }

  // Photos of a printed menu, only when there is no PDF and the menu page is thin.
  if (pdfs.length === 0) {
    for (const p of menuPages.filter((p) => p.text.length < THIN_MENU_PAGE)) {
      for (const src of findMenuImages(p.html, p.url)) {
        if (images.length >= MAX_IMAGES || seen.has(src)) continue;
        seen.add(src);
        try {
          const f = await fetcher(src, MAX_IMAGE_BYTES);
          if (isImage(f) && f.body.length >= MIN_IMAGE_BYTES) {
            images.push({ url: f.url, data: f.body, mediaType: f.contentType.split(";")[0].trim() });
          }
        } catch {
          // skip unreadable images
        }
      }
    }
  }

  let pdfBytes = 0;
  const bestPdfs = pdfs
    .sort((a, b) => b.score - a.score)
    .filter((p) => (pdfBytes + p.data.length <= MAX_TOTAL_PDF_BYTES ? ((pdfBytes += p.data.length), true) : false))
    .slice(0, MAX_PDFS);
  const sourceUrls = [...texts.map((t) => t.url), ...bestPdfs.map((p) => p.url), ...images.map((i) => i.url)];
  const textChars = texts.reduce((n, t) => n + t.text.length, 0);
  if (bestPdfs.length === 0 && images.length === 0 && textChars < MIN_TOTAL_TEXT) {
    return { kind: "none", status: "no_menu_found", sourceUrls, note: "almost no readable text", siteDomain: siteDomain(home.url) };
  }

  const bestMenuPage = menuPages.find((p) => p.text.length > MIN_PAGE_TEXT || images.length > 0);
  const [primaryUrl, sourceType]: [string, "html" | "pdf" | "image"] = bestPdfs.length
    ? [bestPdfs[0].url, "pdf"]
    : images.length
      ? [bestMenuPage?.url ?? home.url, "image"]
      : [bestMenuPage?.url ?? home.url, "html"];

  return {
    kind: "sources",
    sources: { texts, pdfs: bestPdfs.map(({ url, data }) => ({ url, data })), images },
    sourceUrls,
    primaryUrl,
    sourceType,
    imageUrl: shareImage ? await checkImage(fetcher, shareImage) : null,
    siteDomain: siteDomain(home.url),
  };
}

// The share image is shown straight from the café's site, so only check that it is a real, decent-sized image.
async function checkImage(fetcher: MenuFetcher, url: string): Promise<string | null> {
  try {
    const f = await fetcher(url, MAX_IMAGE_BYTES);
    return isImage(f) && f.body.length >= MIN_SHARE_IMAGE_BYTES ? url : null;
  } catch {
    return null;
  }
}
