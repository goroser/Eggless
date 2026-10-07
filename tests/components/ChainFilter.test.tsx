// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EgglessApp } from "@/components/EgglessApp";
import type { CafeResult, Rect } from "@/lib/types";
import { cafe } from "../helpers/fixtures";
import { stubIntersectionObserver } from "../helpers/intersection";

vi.mock("@/components/CafeMap", () => ({
  CafeMap: ({ cafes, onBoundsChange }: { cafes: CafeResult[]; onBoundsChange: (r: Rect) => void }) => {
    useEffect(() => {
      onBoundsChange({ low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } });
    }, [onBoundsChange]);
    return <div data-testid="map">{cafes.map((c) => <span key={c.placeId} data-testid="pin">{c.placeId}</span>)}</div>;
  },
}));

const results = (list: CafeResult[]) => vi.fn(async () => Response.json({ cafes: list }));
const mixed = [cafe("gails", { options: 5 }, { name: "GAIL's", chain: true }), cafe("local", { options: 3 }, { name: "Local" })];

async function searchWith(list: CafeResult[]) {
  vi.stubGlobal("fetch", results(list));
  render(<EgglessApp />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Искать здесь" })));
}
const pins = () => screen.queryAllByTestId("pin").map((p) => p.textContent);

beforeEach(() => {
  stubIntersectionObserver();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chain filter", () => {
  test("hides chain cards and pins, and remembers the choice", async () => {
    await searchWith(mixed);
    expect(pins()).toEqual(["gails", "local"]);
    fireEvent.click(screen.getByRole("button", { name: "Без сетей" }));
    expect(pins()).toEqual(["local"]);
    expect(screen.queryByText("GAIL's")).toBeNull();
    expect(localStorage.getItem("eggless.hideChains")).toBe("1");
  });

  test("a remembered choice applies on the next visit", async () => {
    localStorage.setItem("eggless.hideChains", "1");
    await searchWith(mixed);
    expect(pins()).toEqual(["local"]);
  });

  test("works when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await searchWith(mixed);
    fireEvent.click(screen.getByRole("button", { name: "Без сетей" }));
    expect(pins()).toEqual(["local"]);
  });

  test("when every result is a chain, offer to show them", async () => {
    localStorage.setItem("eggless.hideChains", "1");
    await searchWith([mixed[0]]);
    expect(screen.getByText("Здесь не нашлось кафе")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Показать сети" }));
    expect(pins()).toEqual(["gails"]);
  });
});
