import { describe, expect, test } from "vitest";
import { plural, ru } from "@/lib/i18n/ru";

const dishes: [string, string, string] = ["блюдо", "блюда", "блюд"];

describe("plural", () => {
  test.each([
    [0, "блюд"],
    [1, "блюдо"],
    [2, "блюда"],
    [4, "блюда"],
    [5, "блюд"],
    [11, "блюд"],
    [12, "блюд"],
    [21, "блюдо"],
    [22, "блюда"],
    [25, "блюд"],
    [111, "блюд"],
  ])("%i → %s", (n, form) => expect(plural(n, dishes)).toBe(form));
});

describe("ru", () => {
  test("counts", () => {
    expect(ru.eggHidden(12)).toBe("12 блюд с яйцом скрыто");
    expect(ru.eggHidden(1)).toBe("1 блюдо с яйцом скрыто");
    expect(ru.options(6)).toBe("6 без яиц");
    expect(ru.adaptable(4)).toBe("+4 можно без яйца");
  });

  test("menu read date", () => expect(ru.menuRead("2026-10-05T09:00:00.000Z")).toBe("Меню прочитано 5 окт"));

  test.each([
    ["until 11:30", "завтраки до 11:30"],
    ["Served till 11.30am", "завтраки до 11:30"],
    ["until 12pm", "завтраки до 12:00"],
    ["until 3:30 pm", "завтраки до 15:30"],
    ["all day", null],
    [null, null],
  ])("servedUntil(%j)", (text, out) => expect(ru.servedUntil(text)).toBe(out));

  test("every string is non-empty Russian", () => {
    for (const [key, value] of Object.entries(ru)) {
      if (typeof value !== "string") continue;
      expect(value, key).toMatch(/[А-Яа-яЁё]/);
    }
  });

  test("copy matches the spec", () => {
    expect(ru.searchArea).toBe("Искать здесь");
    expect(ru.nearMe).toBe("Рядом со мной");
    expect(ru.quota).toBe("Лимит поиска на сегодня исчерпан, попробуйте завтра");
    expect(ru.hideChains).toBe("Без сетей");
    expect(ru.showChains).toBe("Показать сети");
    expect(ru.chain).toBe("Сеть");
    expect(ru.privatePage).toBe("Это личная страница. Попросите у Романа ссылку.");
  });
});
