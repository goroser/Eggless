import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findCandidates, findMenuImages, htmlToText } from "@/lib/menu/discover";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");
const urls = (html: string, base: string) => findCandidates(html, base).map((c) => c.url);

describe("findCandidates on real pages", () => {
  test("My Place: the three Wix menu PDFs", () => {
    const cands = findCandidates(fixture("myplace-menu.html"), "https://www.myplacechiswick.com/menu");
    const pdfs = cands.filter((c) => /myplacechiswick\.com\/_files\/ugd\/bc88c2_.*\.pdf$/.test(c.url));
    expect(pdfs).toHaveLength(3);
  });

  test("Heisenberg home: the café's own /menu beats booking links", () => {
    const cands = findCandidates(fixture("heisenberg-home.html"), "https://heisenbergbreakfastco.com/");
    expect(cands[0].url).toBe("https://heisenbergbreakfastco.com/menu");
    expect(cands.some((c) => /exploretock/.test(c.url))).toBe(false);
  });

  test("Heisenberg menu page: Showit PDF", () => {
    expect(urls(fixture("heisenberg-menu.html"), "https://heisenbergbreakfastco.com/menu")).toContain(
      "https://static.showit.co/file/QglTkQJzR4KwQRY1RH2Z5g/167493/heisenberg_menu.pdf",
    );
  });

  test("Arcane: Squarespace PDFs one hop below the menu page", () => {
    const found = urls(fixture("arcane-our-menu.html"), "https://www.arcane.london/our-menu").filter((u) =>
      /^https:\/\/www\.arcane\.london\/s\/.*\.pdf$/.test(u),
    );
    expect(found.length).toBeGreaterThanOrEqual(3);
  });
});

describe("findCandidates scoring", () => {
  const base = "https://cafe.example/";

  test("a drinks menu scores below a breakfast page", () => {
    const cands = findCandidates(
      `<a href="/drinks-menu">Drinks</a><a href="/breakfast">Breakfast</a>`,
      base,
    );
    const score = (u: string) => cands.find((c) => c.url === u)?.score ?? -Infinity;
    expect(score("https://cafe.example/breakfast")).toBeGreaterThan(score("https://cafe.example/drinks-menu"));
  });

  test("delivery platforms are skipped", () => {
    expect(urls(`<a href="https://deliveroo.co.uk/menu/x">Menu</a>`, base)).toEqual([]);
  });

  test("PDFs referenced only from scripts are found", () => {
    const cands = findCandidates(
      `<script>window.__data={"doc":"//static.showit.co/file/x/menu.pdf","w":"/_files/ugd/ab12_cd34.pdf"}</script>`,
      base,
    );
    expect(cands.find((c) => c.url === "https://static.showit.co/file/x/menu.pdf")?.why).toBe("raw-pdf");
    expect(cands.find((c) => c.url === "https://cafe.example/_files/ugd/ab12_cd34.pdf")?.why).toBe("raw-pdf");
  });

  test("JSON-LD hasMenu becomes a candidate", () => {
    const cands = findCandidates(
      `<script type="application/ld+json">{"@type":"Restaurant","hasMenu":"https://cafe.example/menu.pdf"}</script>`,
      base,
    );
    expect(cands.find((c) => c.url === "https://cafe.example/menu.pdf")?.why).toBe("json-ld");
  });

  test("candidates are deduped and sorted by score", () => {
    const cands = findCandidates(
      `<a href="/menu">Menu</a><a href="/menu#top">Our menu</a><a href="/brunch-menu">Brunch</a>`,
      base,
    );
    expect(cands.map((c) => c.url)).toEqual(["https://cafe.example/brunch-menu", "https://cafe.example/menu"]);
  });
});

describe("findMenuImages", () => {
  const base = "https://cafe.example/menu";

  test("rewrites Wix thumbnails to the original image", () => {
    expect(
      findMenuImages(`<img src="https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_170,h_170/abc.jpg">`, base),
    ).toEqual(["https://static.wixstatic.com/media/abc~mv2.jpg"]);
  });

  test("drops logos, icons and data URIs", () => {
    expect(
      findMenuImages(
        `<img src="/logo.png"><img src="/a.jpg" alt="Instagram Icon"><img src="data:image/png;base64,xx"><img src="/menu-1.jpg">`,
        base,
      ),
    ).toEqual(["https://cafe.example/menu-1.jpg"]);
  });

  test("prefers data-src over src", () => {
    expect(findMenuImages(`<img src="/placeholder.gif" data-src="/real-menu.jpg">`, base)).toEqual([
      "https://cafe.example/real-menu.jpg",
    ]);
  });
});

describe("htmlToText", () => {
  test("strips non-content elements and collapses whitespace", () => {
    expect(
      htmlToText(
        `<body><script>x()</script><style>p{}</style><noscript>n</noscript><svg><text>s</text></svg><iframe>i</iframe><h1>Menu</h1>\n\n  <p>Porridge   £6</p></body>`,
      ),
    ).toBe("Menu Porridge £6");
  });
});
