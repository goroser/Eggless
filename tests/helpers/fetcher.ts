import type { Fetched, MenuFetcher } from "@/lib/types";

// A MenuFetcher over an in-memory site. Unknown URLs reject like a real 404.
export function fixtureFetcher(pages: Record<string, { contentType: string; body: string | Buffer } | Error>) {
  const calls: string[] = [];
  const fetcher: MenuFetcher = async (url, maxBytes) => {
    calls.push(url);
    const page = pages[url];
    if (!page) throw new Error("HTTP 404");
    if (page instanceof Error) throw page;
    const body = Buffer.isBuffer(page.body) ? page.body : Buffer.from(page.body);
    if (body.length > maxBytes) throw new Error(`over ${maxBytes} bytes`);
    return { url, contentType: page.contentType, body } satisfies Fetched;
  };
  return { fetcher, calls };
}

export const html = (body: string) => ({ contentType: "text/html; charset=utf-8", body: `<html><body>${body}</body></html>` });
export const pdf = (bytes = 2000) => ({ contentType: "application/pdf", body: Buffer.alloc(bytes, 1) });
export const jpeg = (bytes: number) => ({ contentType: "image/jpeg", body: Buffer.alloc(bytes, 7) });
export const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
