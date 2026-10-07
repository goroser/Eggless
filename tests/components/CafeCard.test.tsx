// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CafeCard } from "@/components/CafeCard";
import type { CafeState } from "@/lib/client/useCafes";
import { cafe, dish, summary } from "../helpers/fixtures";

afterEach(cleanup);

const egg = Array.from({ length: 12 }, (_, i) => dish(`Egg dish ${i}`, { eggStatus: "egg_main" }));
const okCafe = (over: Partial<CafeState> = {}): CafeState => ({
  ...cafe("p1", null, { name: "Post Room", rating: 4.5, userRatingCount: 120, openNow: true }),
  menu: summary({
    counts: { options: 6, adaptable: 4, eggMain: 12, total: 22 },
    servedUntil: "until 11:30",
    sourceUrl: "https://postroom.example/menu.pdf",
    extractedAt: "2026-10-05T09:00:00.000Z",
    dishes: [
      dish("Granola", { price: "£7.50" }),
      dish("Croissant", { substantial: false, price: "£3" }),
      dish("Pancakes", { price: "£12.50" }),
      dish("Acai bowl", { price: "£9" }),
      dish("Porridge", { price: "£6" }),
      dish("Full English", { eggStatus: "egg_component", price: "£15" }),
      ...egg,
    ],
  }),
  loading: false,
  ...over,
});

const renderCard = (c: CafeState) => {
  const onRetry = vi.fn();
  const onSelect = vi.fn();
  render(<CafeCard cafe={c} onRetry={onRetry} onSelect={onSelect} />);
  return { onRetry, onSelect };
};

describe("CafeCard", () => {
  test("shows the headline, details and top three dishes", () => {
    renderCard(okCafe());
    expect(screen.getByText("Post Room")).toBeTruthy();
    expect(screen.getByText("4.5 (120)")).toBeTruthy();
    expect(screen.getByText("Открыто")).toBeTruthy();
    expect(screen.getByText("6 без яиц")).toBeTruthy();
    expect(screen.getByText("+4 можно без яйца")).toBeTruthy();
    const top = within(screen.getByTestId("top-dishes"));
    expect(top.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Granola£7.50", "Pancakes£12.50", "Acai bowl£9"]);
    expect(screen.getByRole("link", { name: "Меню на сайте" }).getAttribute("href")).toBe("https://postroom.example/menu.pdf");
    expect(screen.getByRole("link", { name: "Google Карты" }).getAttribute("href")).toBe("https://maps.google.com/?cid=p1");
  });

  test("full menu groups dishes and hides egg dishes until tapped", () => {
    renderCard(okCafe());
    fireEvent.click(screen.getByRole("button", { name: "Всё меню" }));
    const full = within(screen.getByTestId("full-menu"));
    expect(full.getByText("Попросите без яйца")).toBeTruthy();
    expect(full.getByText("Full English")).toBeTruthy();
    expect(full.getByText("Croissant").closest("li")?.className).toContain("text-stone-400");
    expect(full.queryByText("Egg dish 0")).toBeNull();
    fireEvent.click(full.getByRole("button", { name: "12 блюд с яйцом скрыто" }));
    expect(full.getByText("Egg dish 0")).toBeTruthy();
  });

  test("footer shows when the menu was read and serving time", () => {
    renderCard(okCafe());
    expect(screen.getByText(/Меню прочитано 5 окт/)).toBeTruthy();
    expect(screen.getByText(/завтраки до 11:30/)).toBeTruthy();
  });

  test("missing rating and opening hours are omitted", () => {
    renderCard(okCafe({ rating: undefined, userRatingCount: undefined, openNow: undefined }));
    expect(document.body.textContent).not.toMatch(/undefined|Закрыто|Открыто/);
  });

  test("closed cafés say so", () => {
    renderCard(okCafe({ openNow: false }));
    expect(screen.getByText("Закрыто")).toBeTruthy();
  });

  test("loading shows the reading copy", () => {
    renderCard(okCafe({ menu: null, loading: true }));
    expect(screen.getByText("Читаем меню…")).toBeTruthy();
  });

  test("failed shows the copy and a retry button", () => {
    const { onRetry } = renderCard(okCafe({ menu: null, failed: { expired: false } }));
    expect(screen.getByText("Не удалось прочитать меню")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalled();
  });

  test("tapping the name selects the café", () => {
    const { onSelect } = renderCard(okCafe());
    fireEvent.click(screen.getByRole("button", { name: "Post Room" }));
    expect(onSelect).toHaveBeenCalled();
  });

  test("unknown menu statuses show their copy", () => {
    renderCard(okCafe({ menu: summary({ status: "no_website", counts: null, sourceUrl: null }) }));
    expect(screen.getByText("Меню не найдено в интернете")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Всё меню" })).toBeNull();
  });

  test("the serving time shows only when a time can be read", () => {
    const c = okCafe();
    renderCard({ ...c, menu: { ...c.menu!, servedUntil: "all day" } });
    expect(document.body.textContent).not.toMatch(/завтраки до/);
  });
});
