import { describe, expect, test } from "vitest";
import { signPhotoRef, signToken, verifyPhotoRef, verifyToken } from "@/lib/token";

const SECRET = "s".repeat(32);
const NOW = 1_780_000_000_000;
const payload = { placeId: "ChIJ123", websiteUri: "https://cafe.example/" };

describe("tokens", () => {
  test("round trip", () => {
    expect(verifyToken(signToken(payload, SECRET, NOW), SECRET, NOW + 1000)).toEqual(payload);
  });

  test("another secret is rejected", () => {
    expect(verifyToken(signToken(payload, SECRET, NOW), "x".repeat(32), NOW)).toBeNull();
  });

  test("a tampered payload is rejected", () => {
    const t = signToken(payload, SECRET, NOW);
    const [body, sig] = t.split(".");
    const flipped = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    expect(verifyToken(`${flipped}.${sig}`, SECRET, NOW)).toBeNull();
  });

  test("expires after 10 minutes", () => {
    const t = signToken(payload, SECRET, NOW);
    expect(verifyToken(t, SECRET, NOW + 599_000)).toEqual(payload);
    expect(verifyToken(t, SECRET, NOW + 601_000)).toBeNull();
  });

  test.each(["", "a.b", "...", "abc", "😀.😀"])("garbage %j is rejected without throwing", (t) => {
    expect(verifyToken(t, SECRET, NOW)).toBeNull();
  });
});

describe("photo refs", () => {
  const NAME = "places/ChIJabc/photos/AUc7xyz";
  test("round trip", () => expect(verifyPhotoRef(signPhotoRef(NAME, SECRET, NOW), SECRET, NOW + 1000)).toBe(NAME));
  test("expires after 10 minutes", () => expect(verifyPhotoRef(signPhotoRef(NAME, SECRET, NOW), SECRET, NOW + 601_000)).toBeNull());
  test("a menu token is not a photo ref", () => expect(verifyPhotoRef(signToken(payload, SECRET, NOW), SECRET, NOW)).toBeNull());
  test("a photo ref is not a menu token", () => expect(verifyToken(signPhotoRef(NAME, SECRET, NOW), SECRET, NOW)).toBeNull());
});

