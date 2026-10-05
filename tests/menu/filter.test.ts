import { describe, expect, test } from "vitest";
import { filterDishes } from "@/lib/menu/filter";
import { dish } from "../helpers/fixtures";

const names = (ds: ReturnType<typeof dish>[]) => filterDishes(ds).map((d) => d.name);

describe("filterDishes", () => {
  test("drops region-only items", () => {
    expect(names([dish("Pork Sausage Brioche (NI)"), dish("Bacon Roll (ROI)"), dish("Porridge (Scotland)"), dish("Porridge")])).toEqual([
      "Porridge",
    ]);
  });

  test("drops catering and sharing items by name or section", () => {
    expect(
      names([
        dish("Croissant Platter"),
        dish("Yoghurt Pot", { section: "Catering" }),
        dish("Pastry sharing box"),
        dish("Breakfast tray for 6 people"),
        dish("Pancakes"),
      ]),
    ).toEqual(["Pancakes"]);
  });

  test.each(["Drinks", "Hot drinks", "Coffee", "Tea", "Wine", "Cocktails", "Smoothies", "Juices", "  coffee "])(
    "drops a section named %j",
    (section) => {
      expect(names([dish("Something", { section })])).toEqual([]);
    },
  );

  test("keeps a mixed section like Coffee & Breakfast", () => {
    expect(names([dish("Bacon bap", { section: "Coffee & Breakfast" })])).toEqual(["Bacon bap"]);
  });

  test("de-duplicates by normalised name, keeping the first", () => {
    const out = filterDishes([dish("Fruit Salad", { price: "£5" }), dish("fruit salad ", { price: "£6" })]);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe("£5");
  });
});
