import { describe, expect, test } from "vitest";
import { headline } from "@/lib/client/format";
import { summary } from "../helpers/fixtures";

const counts = (options: number, adaptable: number) => ({ options, adaptable, eggMain: 3, total: 10 });

describe("headline", () => {
  test("options with adaptable", () =>
    expect(headline(summary({ counts: counts(6, 4) }))).toEqual({ main: "6 egg-free", extra: "+4 ask without egg" }));
  test("no adaptable, no extra", () => expect(headline(summary({ counts: counts(6, 0) }))).toEqual({ main: "6 egg-free" }));
  test.each([
    ["no_website", "Menu not online"],
    ["no_menu_found", "Menu not online"],
    ["no_breakfast", "No breakfast menu"],
    ["fetch_failed", "Couldn't read the menu"],
    ["pending", "Reading the menu…"],
  ] as const)("%s", (status, main) => expect(headline(summary({ status, counts: null }))).toEqual({ main }));
  test("unknown", () => expect(headline(null)).toEqual({ main: "Reading the menu…" }));
});
