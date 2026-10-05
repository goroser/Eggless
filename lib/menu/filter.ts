import type { Dish } from "@/lib/types";

// Items the model is told to skip but sometimes keeps (seen in the Phase 0 spike).
const REGION_ONLY = /\((NI|ROI|Scotland|Wales)\)/i;
const NOT_A_CAFE_DISH = /platter|catering|sharing box|for \d+ people/i;
const DRINKS_SECTION = /^(drinks|hot drinks|coffee|tea|wine|cocktails|smoothies|juices)$/i;

const normalise = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

export function filterDishes(dishes: Dish[]): Dish[] {
  const seen = new Set<string>();
  return dishes.filter((d) => {
    if (REGION_ONLY.test(d.name)) return false;
    if (NOT_A_CAFE_DISH.test(d.name) || NOT_A_CAFE_DISH.test(d.section)) return false;
    if (DRINKS_SECTION.test(d.section.trim())) return false;
    const key = normalise(d.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
