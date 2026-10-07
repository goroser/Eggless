// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EgglessApp } from "@/components/EgglessApp";
import type { CafeResult, Rect } from "@/lib/types";
import { cafe } from "../helpers/fixtures";
import { stubIntersectionObserver } from "../helpers/intersection";

vi.mock("@/components/CafeMap", () => ({
  CafeMap: (props: {
    cafes: CafeResult[];
    onBoundsChange: (r: Rect) => void;
    onSelect: (id: string) => void;
    onMapClick: () => void;
  }) => {
    useEffect(() => {
      props.onBoundsChange({ low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } });
    }, [props.onBoundsChange]);
    return (
      <div>
        <button type="button" onClick={props.onMapClick}>map background</button>
        {props.cafes.map((c) => (
          <button key={c.placeId} type="button" data-chain={String(c.chain)} onClick={() => props.onSelect(c.placeId)}>
            pin {c.placeId}
          </button>
        ))}
      </div>
    );
  },
}));

const list = [
  cafe("jajo", { options: 8 }, { name: "JAJO", photos: [{ ref: "r1", attribution: { name: "A", uri: "" } }] }),
  cafe("gails", { options: 5 }, { name: "GAIL's", chain: true }),
];

let scrolled: string[];
beforeEach(() => {
  stubIntersectionObserver();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cafes: list })));
  scrolled = [];
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

async function start() {
  render(<EgglessApp />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Искать здесь" })));
}
const mapBox = () => screen.getByTestId("map-container");
const isFull = () => mapBox().className.includes("fixed") && mapBox().className.includes("inset-0");

describe("full-screen map", () => {
  test("opens and closes with the buttons, using one history entry", async () => {
    await start();
    const before = history.length;
    fireEvent.click(screen.getByRole("button", { name: "Карта на весь экран" }));
    expect(isFull()).toBe(true);
    expect(history.length).toBe(before + 1);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть карту" }));
    expect(isFull()).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  test("the back gesture closes full screen", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Карта на весь экран" }));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(isFull()).toBe(false);
  });

  test("opening and closing repeatedly does not pile up history", async () => {
    await start();
    const before = history.length;
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Карта на весь экран" }));
      fireEvent.click(screen.getByRole("button", { name: "Закрыть карту" }));
    }
    expect(history.length).toBeLessThanOrEqual(before + 1);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(isFull()).toBe(false);
  });

  test("a pin opens a preview; tapping the map hides it; «Подробнее» goes to the card", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Карта на весь экран" }));
    fireEvent.click(screen.getByRole("button", { name: "pin jajo" }));
    const preview = within(screen.getByTestId("map-preview"));
    expect(preview.getByText("JAJO")).toBeTruthy();
    expect(preview.getByText("8 без яиц")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "map background" }));
    expect(screen.queryByTestId("map-preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "pin gails" }));
    expect(within(screen.getByTestId("map-preview")).getByText("Сеть")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Подробнее" }));
    expect(isFull()).toBe(false);
    await waitFor(() => expect(scrolled).toContain("cafe-gails"));
  });

  test("outside full screen a pin scrolls to the card, as before", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "pin jajo" }));
    expect(scrolled).toContain("cafe-jajo");
    expect(screen.queryByTestId("map-preview")).toBeNull();
  });

  test("the map receives the chain flag for hollow pins", async () => {
    await start();
    expect(screen.getByRole("button", { name: "pin gails" }).getAttribute("data-chain")).toBe("true");
    expect(screen.getByRole("button", { name: "pin jajo" }).getAttribute("data-chain")).toBe("false");
  });

  test("the page owns scroll position, so going back does not undo «Подробнее»", async () => {
    await start();
    expect(history.scrollRestoration).toBe("manual");
  });
});
