import type { MenuSummary } from "@/lib/types";

export type FetchMenuResult =
  | { kind: "done"; menu: MenuSummary }
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "error"; retry: boolean };

export type FetchMenu = (token: string) => Promise<FetchMenuResult>;

export type QueueResult = { menu: MenuSummary } | { failed: true; expired: boolean };

// Reads café menus a few at a time, never the same café twice at once.
// cancelAll() drops everything, including results still on their way back.
export function createMenuQueue(opts: {
  fetchMenu: FetchMenu;
  concurrency?: number;
  pendingDelayMs?: number;
  maxPendingPolls?: number;
  onResult: (placeId: string, r: QueueResult) => void;
}): { enqueue(placeId: string, token: string): void; cancelAll(): void } {
  const concurrency = opts.concurrency ?? 3;
  const pendingDelayMs = opts.pendingDelayMs ?? 3000;
  const maxPendingPolls = opts.maxPendingPolls ?? 15;

  let generation = 0;
  let waiting: { placeId: string; token: string }[] = [];
  const active = new Set<string>();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function run(placeId: string, token: string, gen: number) {
    let result: QueueResult | null = null;
    for (let polls = 0; !result; ) {
      let r: FetchMenuResult;
      try {
        r = await opts.fetchMenu(token);
      } catch {
        r = { kind: "error", retry: true };
      }
      if (gen !== generation) return;
      if (r.kind === "done") result = { menu: r.menu };
      else if (r.kind === "expired") result = { failed: true, expired: true };
      else if (r.kind === "error" || ++polls > maxPendingPolls) result = { failed: true, expired: false };
      else {
        await sleep(pendingDelayMs);
        if (gen !== generation) return;
      }
    }
    active.delete(placeId);
    opts.onResult(placeId, result);
    pump();
  }

  function pump() {
    while (active.size < concurrency && waiting.length) {
      const next = waiting.shift()!;
      active.add(next.placeId);
      void run(next.placeId, next.token, generation);
    }
  }

  return {
    enqueue(placeId, token) {
      if (active.has(placeId) || waiting.some((w) => w.placeId === placeId)) return;
      waiting.push({ placeId, token });
      pump();
    },
    cancelAll() {
      generation++;
      waiting = [];
      active.clear();
    },
  };
}
