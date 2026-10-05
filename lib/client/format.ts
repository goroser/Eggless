import type { MenuSummary } from "@/lib/types";

export function headline(menu: MenuSummary | null): { main: string; extra?: string } {
  switch (menu?.status) {
    case "ok": {
      const c = menu.counts ?? { options: 0, adaptable: 0 };
      return c.adaptable > 0
        ? { main: `${c.options} egg-free`, extra: `+${c.adaptable} ask without egg` }
        : { main: `${c.options} egg-free` };
    }
    case "no_website":
    case "no_menu_found":
      return { main: "Menu not online" };
    case "no_breakfast":
      return { main: "No breakfast menu" };
    case "fetch_failed":
      return { main: "Couldn't read the menu" };
    default:
      return { main: "Reading the menu…" };
  }
}
