import { describe, expect, test } from "vitest";
import { headline } from "@/lib/client/format";
import { summary } from "../helpers/fixtures";

const counts = (options: number, adaptable: number) => ({ options, adaptable, eggMain: 3, total: 10 });

describe("headline", () => {
  test("options with adaptable", () =>
    expect(headline(summary({ counts: counts(6, 4) }))).toEqual({ main: "6 без яиц", extra: "+4 можно без яйца" }));
  test("no adaptable, no extra", () => expect(headline(summary({ counts: counts(6, 0) }))).toEqual({ main: "6 без яиц" }));
  test.each([
    ["no_website", "Меню не найдено в интернете"],
    ["no_menu_found", "Меню не найдено в интернете"],
    ["no_breakfast", "Нет завтраков в меню"],
    ["fetch_failed", "Не удалось прочитать меню"],
    ["pending", "Читаем меню…"],
  ] as const)("%s", (status, main) => expect(headline(summary({ status, counts: null }))).toEqual({ main }));
  test("unknown", () => expect(headline(null)).toEqual({ main: "Читаем меню…" }));
});
