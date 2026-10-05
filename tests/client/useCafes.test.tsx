// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCafes } from "@/lib/client/useCafes";
import type { CafeResult } from "@/lib/types";
import { cafe, summary } from "../helpers/fixtures";

const RECT = { low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } };
const okMenu = (options: number) => summary({ counts: { options, adaptable: 0, eggMain: 0, total: options } });

type Handler = (url: string, body: Record<string, unknown>) => Promise<Response> | Response;

function stubFetch(handler: Handler) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, body });
      return handler(url, body);
    }),
  );
  return calls;
}

const searchResponse = (cafes: CafeResult[]) => Response.json({ cafes });

afterEach(() => vi.unstubAllGlobals());

describe("useCafes", () => {
  test("search lists cafés, loads missing menus and re-ranks as they arrive", async () => {
    const calls = stubFetch((url, body) => {
      if (url === "/api/search") {
        return searchResponse([
          cafe("known", { options: 2 }),
          cafe("new", null, { token: "t-new" }),
        ]);
      }
      if (body.token === "t-new") return Response.json(okMenu(5));
      throw new Error(`unexpected ${url}`);
    });
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    expect(calls[0]).toEqual({ url: "/api/search", body: { rect: RECT } });
    await waitFor(() => expect(result.current.cafes.map((c) => c.placeId)).toEqual(["new", "known"]));
    expect(result.current.cafes.every((c) => !c.loading)).toBe(true);
  });

  test("cafés waiting for a menu are marked loading", async () => {
    stubFetch((url) => (url === "/api/search" ? searchResponse([cafe("new", null, { token: "t" })]) : new Promise<Response>(() => {})));
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    expect(result.current.cafes[0].loading).toBe(true);
  });

  test("a newer search drops late results from the older one", async () => {
    let releaseOld!: (r: Response) => void;
    stubFetch((url, body) => {
      if (url === "/api/search") {
        return "near" in body ? searchResponse([cafe("second", { options: 1 })]) : searchResponse([cafe("first", null, { token: "old" })]);
      }
      return new Promise<Response>((r) => (releaseOld = r));
    });
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    await waitFor(() => expect(releaseOld).toBeDefined());
    await act(() => result.current.search({ near: { lat: 51.49, lng: -0.26 } }));
    await act(async () => releaseOld(Response.json(okMenu(9))));
    expect(result.current.cafes.map((c) => c.placeId)).toEqual(["second"]);
  });

  test("an older search response arriving late does not replace a newer one", async () => {
    let releaseFirst!: (r: Response) => void;
    stubFetch((url, body) => {
      if ("near" in body) return searchResponse([cafe("second", { options: 1 })]);
      return new Promise<Response>((r) => (releaseFirst = r));
    });
    const { result } = renderHook(() => useCafes());
    let first!: Promise<void>;
    act(() => {
      first = result.current.search({ rect: RECT });
    });
    await act(() => result.current.search({ near: { lat: 51.49, lng: -0.26 } }));
    await act(async () => {
      releaseFirst(searchResponse([cafe("first", { options: 3 })]));
      await first;
    });
    expect(result.current.cafes.map((c) => c.placeId)).toEqual(["second"]);
  });

  test("quota exhausted shows the copy", async () => {
    stubFetch(() => Response.json({ error: "Daily search limit reached, try again tomorrow" }, { status: 503 }));
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    expect(result.current.error).toBe("Daily search limit reached, try again tomorrow");
  });

  test("retry after an expired token re-runs the last search", async () => {
    let searches = 0;
    stubFetch((url) => {
      if (url === "/api/search") {
        searches++;
        return searchResponse([cafe("a", null, { token: `t${searches}` })]);
      }
      return searches === 1 ? Response.json({ error: "invalid token" }, { status: 401 }) : Response.json(okMenu(4));
    });
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    await waitFor(() => expect(result.current.cafes[0].failed).toEqual({ expired: true }));
    await act(async () => result.current.retry("a"));
    await waitFor(() => expect(result.current.cafes[0].menu?.counts?.options).toBe(4));
    expect(searches).toBe(2);
  });

  test("retry after a temporary failure re-asks for just that café", async () => {
    let menuCalls = 0;
    stubFetch((url) => {
      if (url === "/api/search") return searchResponse([cafe("a", null, { token: "t" })]);
      menuCalls++;
      return menuCalls === 1 ? Response.json({ error: "temporary", retry: true }, { status: 503 }) : Response.json(okMenu(2));
    });
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    await waitFor(() => expect(result.current.cafes[0].failed).toEqual({ expired: false }));
    await act(async () => result.current.retry("a"));
    await waitFor(() => expect(result.current.cafes[0].menu?.counts?.options).toBe(2));
    expect(result.current.cafes[0].failed).toBeUndefined();
  });

  test("a failed newer search does not leave earlier cards loading forever", async () => {
    let searches = 0;
    stubFetch((url) => {
      if (url === "/api/search") {
        searches++;
        return searches === 1
          ? searchResponse([cafe("a", null, { token: "t" })])
          : Response.json({ error: "Daily search limit reached, try again tomorrow" }, { status: 503 });
      }
      return new Promise<Response>(() => {});
    });
    const { result } = renderHook(() => useCafes());
    await act(() => result.current.search({ rect: RECT }));
    expect(result.current.cafes[0].loading).toBe(true);
    await act(() => result.current.search({ rect: RECT }));
    expect(result.current.error).toBe("Daily search limit reached, try again tomorrow");
    expect(result.current.cafes[0].loading).toBe(false);
    expect(result.current.cafes[0].failed).toEqual({ expired: false });
  });
});
