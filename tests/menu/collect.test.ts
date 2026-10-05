import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { collectSources } from "@/lib/menu/collect";
import { fixtureFetcher, html, jpeg, pdf, words } from "../helpers/fetcher";

const fixture = (name: string) => ({ contentType: "text/html", body: readFileSync(`tests/fixtures/${name}`, "utf8") });
const SHOWIT_PDF = "https://static.showit.co/file/QglTkQJzR4KwQRY1RH2Z5g/167493/heisenberg_menu.pdf";

describe("collectSources", () => {
  test("Heisenberg: follows home → /menu → PDF (two hops)", async () => {
    const { fetcher } = fixtureFetcher({
      "https://heisenbergbreakfastco.com/": fixture("heisenberg-home.html"),
      "https://heisenbergbreakfastco.com/menu": fixture("heisenberg-menu.html"),
      [SHOWIT_PDF]: pdf(),
    });
    const r = await collectSources(fetcher, "https://heisenbergbreakfastco.com/");
    expect(r.kind).toBe("sources");
    if (r.kind !== "sources") return;
    expect(r.sources.pdfs).toHaveLength(1);
    expect(r.primaryUrl).toBe(SHOWIT_PDF);
    expect(r.sourceType).toBe("pdf");
    expect(r.sourceUrls).toContain(SHOWIT_PDF);
  });

  test("a near-empty site with no candidates has no menu", async () => {
    const { fetcher } = fixtureFetcher({ "https://cafe.example/": html("<p>Welcome! Open 8-4.</p>") });
    const r = await collectSources(fetcher, "https://cafe.example/");
    expect(r).toMatchObject({ kind: "none", status: "no_menu_found" });
  });

  test("a blocked home page is fetch_failed with the reason", async () => {
    const { fetcher } = fixtureFetcher({ "https://cafe.example/": new Error("HTTP 403") });
    const r = await collectSources(fetcher, "https://cafe.example/");
    expect(r).toMatchObject({ kind: "none", status: "fetch_failed" });
    if (r.kind === "none") expect(r.note).toContain("403");
  });

  test("a thin menu page with no PDF sends its photos, ignoring small images, at most 4", async () => {
    const imgs = [1, 2, 3, 4, 5].map((i) => `<img src="/m${i}.jpg">`).join("") + `<img src="/tiny.jpg">`;
    const { fetcher } = fixtureFetcher({
      "https://cafe.example/": html(`<a href="/menu">Menu</a><p>${words(80)}</p>`),
      "https://cafe.example/menu": html(`<h1>Our menu</h1><p>${words(30)}</p>${imgs}`),
      "https://cafe.example/m1.jpg": jpeg(100_000),
      "https://cafe.example/m2.jpg": jpeg(100_000),
      "https://cafe.example/m3.jpg": jpeg(100_000),
      "https://cafe.example/m4.jpg": jpeg(100_000),
      "https://cafe.example/m5.jpg": jpeg(100_000),
      "https://cafe.example/tiny.jpg": jpeg(10_000),
    });
    const r = await collectSources(fetcher, "https://cafe.example/");
    if (r.kind !== "sources") throw new Error("expected sources");
    expect(r.sources.images).toHaveLength(4);
    expect(r.sources.images.every((i) => i.mediaType === "image/jpeg")).toBe(true);
    expect(r.sourceType).toBe("image");
  });

  test("small images alone are ignored", async () => {
    const { fetcher } = fixtureFetcher({
      "https://cafe.example/": html(`<a href="/menu">Menu</a><p>${words(80)}</p>`),
      "https://cafe.example/menu": html(`<p>${words(30)}</p><img src="/tiny.jpg">`),
      "https://cafe.example/tiny.jpg": jpeg(10_000),
    });
    const r = await collectSources(fetcher, "https://cafe.example/");
    if (r.kind !== "sources") throw new Error("expected sources");
    expect(r.sources.images).toHaveLength(0);
  });

  test("keeps only the top 3 PDFs by score", async () => {
    const { fetcher } = fixtureFetcher({
      "https://cafe.example/": html(
        `<p>${words(80)}</p>` +
          `<a href="/breakfast.pdf">Breakfast menu</a><a href="/brunch.pdf">Brunch menu</a>` +
          `<a href="/food.pdf">Food menu</a><a href="/lunch-menu.pdf">Lunch menu</a>`,
      ),
      "https://cafe.example/breakfast.pdf": pdf(),
      "https://cafe.example/brunch.pdf": pdf(),
      "https://cafe.example/food.pdf": pdf(),
      "https://cafe.example/lunch-menu.pdf": pdf(),
    });
    const r = await collectSources(fetcher, "https://cafe.example/");
    if (r.kind !== "sources") throw new Error("expected sources");
    expect(r.sources.pdfs.map((p) => p.url).sort()).toEqual(
      ["https://cafe.example/breakfast.pdf", "https://cafe.example/brunch.pdf", "https://cafe.example/food.pdf"].sort(),
    );
  });

  test("binary content served as text/html does not throw or add text", async () => {
    const garbage = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
    const { fetcher } = fixtureFetcher({
      "https://cafe.example/": html(`<a href="/menu">Menu</a><p>${words(80)}</p>`),
      "https://cafe.example/menu": { contentType: "text/html", body: garbage },
    });
    const r = await collectSources(fetcher, "https://cafe.example/");
    if (r.kind !== "sources") throw new Error("expected sources");
    expect(r.sources.texts.map((t) => t.url)).toEqual(["https://cafe.example/"]);
  });
});
