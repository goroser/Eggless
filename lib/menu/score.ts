import type { CafeResult, Counts, Dish, ExtractedMenu, MenuSummary } from "@/lib/types";

export function countDishes(dishes: Dish[]): Counts {
  return {
    options: dishes.filter((d) => d.eggStatus === "no_egg" && d.substantial).length,
    adaptable: dishes.filter((d) => d.eggStatus === "egg_component").length,
    eggMain: dishes.filter((d) => d.eggStatus === "egg_main").length,
    total: dishes.length,
  };
}

export function menuStatus(menu: ExtractedMenu, counts: Counts): "ok" | "no_menu_found" | "no_breakfast" {
  if (!menu.menuFound) return "no_menu_found";
  if (!menu.hasBreakfast || counts.total === 0) return "no_breakfast";
  return "ok";
}

// Only a read, breakfast-serving menu ranks by counts; everything else sorts after it.
const knownCounts = (menu: MenuSummary | null): Counts | null =>
  menu?.status === "ok" && menu.counts ? menu.counts : null;

export function rankCafes(cafes: CafeResult[]): CafeResult[] {
  return [...cafes].sort((a, b) => {
    const ca = knownCounts(a.menu);
    const cb = knownCounts(b.menu);
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    if (ca && cb) {
      if (cb.options !== ca.options) return cb.options - ca.options;
      if (cb.adaptable !== ca.adaptable) return cb.adaptable - ca.adaptable;
    }
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}

export function pinColor(menu: MenuSummary | null): "green" | "amber" | "red" | "grey" {
  const counts = knownCounts(menu);
  if (!counts) return "grey";
  if (counts.options >= 3) return "green";
  if (counts.options >= 1) return "amber";
  return "red";
}
