import { describe, expect, test } from "vitest";
import { countDishes, menuStatus, pinColor, rankCafes } from "@/lib/menu/score";
import { cafe, dish, summary } from "../helpers/fixtures";

describe("countDishes", () => {
  test("counts options, adaptable and egg dishes", () => {
    const dishes = [
      dish("Porridge"),
      dish("Pancakes"),
      dish("Croissant", { substantial: false }),
      dish("Full English", { eggStatus: "egg_component" }),
      dish("Avo toast + egg", { eggStatus: "egg_component" }),
      dish("Omelette", { eggStatus: "egg_main" }),
      dish("Benedict", { eggStatus: "egg_main" }),
      dish("Shakshuka", { eggStatus: "egg_main" }),
    ];
    expect(countDishes(dishes)).toEqual({ options: 2, adaptable: 2, eggMain: 3, total: 8 });
  });
});

describe("menuStatus", () => {
  const counts = { options: 1, adaptable: 0, eggMain: 0, total: 1 };
  const menu = { menuFound: true, hasBreakfast: true, servedUntil: "", dishes: [dish("Porridge")] };

  test("no menu", () => expect(menuStatus({ ...menu, menuFound: false }, counts)).toBe("no_menu_found"));
  test("no breakfast flag", () => expect(menuStatus({ ...menu, hasBreakfast: false }, counts)).toBe("no_breakfast"));
  test("no dishes", () => expect(menuStatus(menu, { ...counts, total: 0 })).toBe("no_breakfast"));
  test("ok", () => expect(menuStatus(menu, counts)).toBe("ok"));
});

describe("rankCafes", () => {
  const ids = (cs: ReturnType<typeof cafe>[]) => rankCafes(cs).map((c) => c.placeId);

  test("more options first", () => {
    expect(ids([cafe("b", { options: 6, adaptable: 4 }), cafe("a", { options: 7 })])).toEqual(["a", "b"]);
  });

  test("adaptable breaks a tie", () => {
    expect(ids([cafe("b", { options: 6 }), cafe("a", { options: 6, adaptable: 4 })])).toEqual(["a", "b"]);
  });

  test("rating breaks the next tie, missing rating counts as 0", () => {
    expect(
      ids([
        cafe("c", { options: 6, adaptable: 4 }),
        cafe("b", { options: 6, adaptable: 4 }, { rating: 4.0 }),
        cafe("a", { options: 6, adaptable: 4 }, { rating: 4.2 }),
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  test("unknown menus go below a café with zero options", () => {
    const unknown = cafe("u", null);
    const noMenu = cafe("n", null, { menu: summary({ status: "no_menu_found", counts: null }) });
    expect(ids([unknown, noMenu, cafe("z", { options: 0 })])[0]).toBe("z");
  });

  test("does not mutate its input", () => {
    const input = [cafe("b", { options: 1 }), cafe("a", { options: 2 })];
    rankCafes(input);
    expect(input.map((c) => c.placeId)).toEqual(["b", "a"]);
  });
});

describe("pinColor", () => {
  const withOptions = (options: number) => summary({ counts: { options, adaptable: 0, eggMain: 0, total: 5 } });
  test("green at 3+", () => expect(pinColor(withOptions(3))).toBe("green"));
  test("amber at 1-2", () => {
    expect(pinColor(withOptions(1))).toBe("amber");
    expect(pinColor(withOptions(2))).toBe("amber");
  });
  test("red at 0", () => expect(pinColor(withOptions(0))).toBe("red"));
  test.each(["pending", "fetch_failed", "no_menu_found"] as const)("grey for %s", (status) => {
    expect(pinColor(summary({ status, counts: null }))).toBe("grey");
  });
  test("grey when unknown", () => expect(pinColor(null)).toBe("grey"));
});
