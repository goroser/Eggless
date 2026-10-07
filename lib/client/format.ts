import type { MenuSummary } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

export function headline(menu: MenuSummary | null): { main: string; extra?: string } {
  switch (menu?.status) {
    case "ok": {
      const c = menu.counts ?? { options: 0, adaptable: 0 };
      return c.adaptable > 0 ? { main: ru.options(c.options), extra: ru.adaptable(c.adaptable) } : { main: ru.options(c.options) };
    }
    case "no_website":
    case "no_menu_found":
      return { main: ru.noMenu };
    case "no_breakfast":
      return { main: ru.noBreakfast };
    case "fetch_failed":
      return { main: ru.failed };
    default:
      return { main: ru.reading };
  }
}
