import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMenuQueue, type FetchMenu } from "@/lib/client/queue";
import { summary } from "../helpers/fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("createMenuQueue", () => {
  test("runs at most 3 requests at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const pending = new Map<string, ReturnType<typeof deferred<Awaited<ReturnType<FetchMenu>>>>>();
    const fetchMenu: FetchMenu = async (t) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const d = deferred<Awaited<ReturnType<FetchMenu>>>();
      pending.set(t, d);
      const r = await d.promise;
      inFlight--;
      return r;
    };
    const onResult = vi.fn();
    const q = createMenuQueue({ fetchMenu, onResult });
    for (const id of ["a", "b", "c", "d", "e"]) q.enqueue(id, `t-${id}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.size).toBe(3);
    for (const id of ["a", "b", "c", "d", "e"]) {
      pending.get(`t-${id}`)?.resolve({ kind: "done", menu: summary() });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(peak).toBe(3);
    expect(onResult).toHaveBeenCalledTimes(5);
  });

  test("ignores a place already queued or in flight", async () => {
    const fetchMenu = vi.fn<FetchMenu>(async () => ({ kind: "done", menu: summary() }));
    const q = createMenuQueue({ fetchMenu, onResult: vi.fn() });
    q.enqueue("a", "t1");
    q.enqueue("a", "t2");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
  });

  test("polls pending every 3 s and gives up after 15 polls", async () => {
    const fetchMenu = vi.fn<FetchMenu>(async () => ({ kind: "pending" }));
    const onResult = vi.fn();
    createMenuQueue({ fetchMenu, onResult }).enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000 * 20);
    expect(fetchMenu).toHaveBeenCalledTimes(16);
    expect(onResult).toHaveBeenCalledWith("a", { failed: true, expired: false });
  });

  test("an expired token fails at once", async () => {
    const fetchMenu = vi.fn<FetchMenu>(async () => ({ kind: "expired" }));
    const onResult = vi.fn();
    createMenuQueue({ fetchMenu, onResult }).enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("a", { failed: true, expired: true });
  });

  test("errors report a failure", async () => {
    const onResult = vi.fn();
    createMenuQueue({ fetchMenu: async () => ({ kind: "error", retry: true }), onResult }).enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith("a", { failed: true, expired: false });
  });

  test("a thrown fetch reports a failure", async () => {
    const onResult = vi.fn();
    createMenuQueue({ fetchMenu: async () => Promise.reject(new Error("offline")), onResult }).enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith("a", { failed: true, expired: false });
  });

  test("cancelAll stops further calls and suppresses late results", async () => {
    const d = deferred<Awaited<ReturnType<FetchMenu>>>();
    const fetchMenu = vi.fn<FetchMenu>(() => d.promise);
    const onResult = vi.fn();
    const q = createMenuQueue({ fetchMenu, onResult });
    for (const id of ["a", "b", "c", "d"]) q.enqueue(id, id);
    await vi.advanceTimersByTimeAsync(0);
    q.cancelAll();
    d.resolve({ kind: "done", menu: summary() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMenu).toHaveBeenCalledTimes(3);
    expect(onResult).not.toHaveBeenCalled();
  });

  test("a place can be enqueued again after it finished", async () => {
    const fetchMenu = vi.fn<FetchMenu>(async () => ({ kind: "error", retry: true }));
    const q = createMenuQueue({ fetchMenu, onResult: vi.fn() });
    q.enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(0);
    q.enqueue("a", "t");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
  });
});
