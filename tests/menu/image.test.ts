import { describe, expect, test } from "vitest";
import { findShareImage } from "@/lib/menu/image";
import { siteDomain } from "@/lib/chains";

const base = "https://cafe.example/";
const page = (head: string, body = "") => `<html><head>${head}</head><body>${body}</body></html>`;

describe("findShareImage", () => {
  test("og:image, absolute or relative", () => {
    expect(findShareImage(page(`<meta property="og:image" content="https://cdn.cafe.example/room.jpg">`), base)).toBe(
      "https://cdn.cafe.example/room.jpg",
    );
    expect(findShareImage(page(`<meta property="og:image" content="/img/room.jpg">`), base)).toBe("https://cafe.example/img/room.jpg");
  });

  test("twitter:image when there is no og:image", () => {
    expect(findShareImage(page(`<meta name="twitter:image" content="https://cafe.example/t.jpg">`), base)).toBe("https://cafe.example/t.jpg");
  });

  test("JSON-LD image last, string or array", () => {
    const ld = (v: string) => page(`<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","image":${v}}</script>`);
    expect(findShareImage(ld(`"https://cafe.example/ld.jpg"`), base)).toBe("https://cafe.example/ld.jpg");
    expect(findShareImage(ld(`["https://cafe.example/ld1.jpg","https://cafe.example/ld2.jpg"]`), base)).toBe(
      "https://cafe.example/ld1.jpg",
    );
  });

  test.each([
    `<meta property="og:image" content="http://cafe.example/room.jpg">`,
    `<meta property="og:image" content="https://cafe.example/logo.png">`,
    `<meta property="og:image" content="https://cafe.example/favicon.jpg">`,
    `<meta property="og:image" content="https://cafe.example/room.svg">`,
    `<meta property="og:image" content="https://cafe.example/room.jpg"><meta property="og:image:width" content="200">`,
    `<meta property="og:image" content="https://scontent.cdninstagram.com/x.jpg">`,
    `<meta property="og:image" content="https://cafe.example/default-share.jpg">`,
  ])("rejects %s", (head) => {
    expect(findShareImage(page(head), base)).toBeNull();
  });

  test("a rejected og:image falls through to the next source", () => {
    expect(
      findShareImage(
        page(`<meta property="og:image" content="https://cafe.example/logo.png"><meta name="twitter:image" content="https://cafe.example/room.jpg">`),
        base,
      ),
    ).toBe("https://cafe.example/room.jpg");
  });
});

describe("siteDomain", () => {
  test.each([
    ["https://www.Cafe.Example/menu", "cafe.example"],
    ["http://shop.cafe.example/", "shop.cafe.example"],
    ["not a url", null],
  ])("%s → %s", (url, out) => expect(siteDomain(url)).toBe(out));
});
