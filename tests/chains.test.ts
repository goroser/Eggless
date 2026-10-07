import { describe, expect, test } from "vitest";
import { isChain, normaliseName } from "@/lib/chains";

const chain = (name: string, websiteUri?: string, sharedDomain = false) => isChain({ name, websiteUri, sharedDomain });

describe("isChain", () => {
  test.each(["GAIL's Bakery Chiswick", "Caffè Nero", "Pret A Manger", "Joe & The Juice", "Le Pain Quotidien", "Black Sheep Coffee"])(
    "%s is a chain by name",
    (name) => expect(chain(name)).toBe(true),
  );

  test.each(["Leon's Kitchen", "The Post Room Cafe", "Paulina's", "Costaz"])("%s is not", (name) => expect(chain(name)).toBe(false));

  test.each(["https://caffenero.com/uk/store/chiswick-park-71/", "https://x.example/locations/w4", "https://y.example/our-cafes/chiswick"])(
    "store-finder website %s",
    (url) => expect(chain("Local Café", url)).toBe(true),
  );

  test("an ordinary website is not a store finder", () => expect(chain("Local Café", "https://cafe.example/menu")).toBe(false));
  test("a shared domain makes a chain", () => expect(chain("Local Café", "https://cafe.example/", true)).toBe(true));
});

describe("normaliseName", () => {
  test("drops accents, apostrophes and ampersands", () => {
    expect(normaliseName("  Caffè  Nero ")).toBe("caffe nero");
    expect(normaliseName("GAIL’s")).toBe("gails");
    expect(normaliseName("Joe & The Juice")).toBe("joe the juice");
  });
});
