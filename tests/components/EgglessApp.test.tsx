// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EgglessApp } from "@/components/EgglessApp";
import type { Rect } from "@/lib/types";

// The real map needs Google's script; this stand-in just reports a viewport.
vi.mock("@/components/CafeMap", () => ({
  CafeMap: ({ onBoundsChange }: { onBoundsChange: (r: Rect) => void }) => {
    useEffect(() => {
      onBoundsChange({ low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } });
    }, [onBoundsChange]);
    return <div data-testid="map" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EgglessApp", () => {
  test("an empty search says no cafés were found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cafes: [] })));
    render(<EgglessApp />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search this area" })));
    expect(await screen.findByText("No cafés found here")).toBeTruthy();
  });

  test("denied location explains what to do instead", async () => {
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1 }) },
    });
    render(<EgglessApp />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Near me" })));
    expect(screen.getByText("Location is off; pan the map and tap Search this area")).toBeTruthy();
  });
});
