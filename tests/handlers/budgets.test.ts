import { describe, expect, test } from "vitest";
import { DEFAULT_BUDGETS } from "@/lib/handlers/menu";
import { maxDuration } from "@/app/api/menu/route";

const LAST_FETCH_OVERRUN_S = 8; // a fetch started just before the collect deadline can run 8 s past it

describe("menu time budgets", () => {
  test("extraction gets enough time for a full all-day menu (measured ~25 s for 25–34 dishes)", () => {
    expect(DEFAULT_BUDGETS.extractMs).toBeGreaterThanOrEqual(90_000);
  });

  test("collect + extract + overrun fit inside the route's limit with headroom", () => {
    const needed = (DEFAULT_BUDGETS.collectMs + DEFAULT_BUDGETS.extractMs) / 1000 + LAST_FETCH_OVERRUN_S + 10;
    expect(maxDuration).toBeGreaterThanOrEqual(needed);
    expect(maxDuration).toBeLessThanOrEqual(300); // Vercel Hobby limit with Fluid compute
  });
});
