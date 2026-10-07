"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMenuQueue, type FetchMenu, type QueueResult } from "@/lib/client/queue";
import { rankCafes } from "@/lib/menu/score";
import type { CafeResult, LatLng, MenuSummary, Rect } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

export type CafeState = CafeResult & { loading: boolean; failed?: { expired: boolean } };
export type SearchArea = { rect: Rect } | { near: LatLng };

const fetchMenu: FetchMenu = async (token) => {
  const res = await fetch("/api/menu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.status === 200) return { kind: "done", menu: (await res.json()) as MenuSummary };
  if (res.status === 202) return { kind: "pending" };
  if (res.status === 401) return { kind: "expired" };
  return { kind: "error", retry: res.status === 503 };
};

const rank = (cafes: CafeState[]) => rankCafes(cafes) as CafeState[];

// The queue was cancelled for the new search; cards still waiting would otherwise spin forever.
const stopLoading = (cafes: CafeState[]) =>
  cafes.map((c) => (c.loading ? { ...c, loading: false, failed: { expired: false } } : c));

export function useCafes() {
  const [cafes, setCafes] = useState<CafeState[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastArea = useRef<SearchArea | null>(null);
  const searchSeq = useRef(0);

  const onResult = useCallback((placeId: string, r: QueueResult) => {
    setCafes((prev) =>
      rank(
        prev.map((c) =>
          c.placeId !== placeId
            ? c
            : "menu" in r
              ? { ...c, menu: r.menu, loading: false, failed: undefined }
              : { ...c, loading: false, failed: { expired: r.expired } },
        ),
      ),
    );
  }, []);

  const queue = useRef<ReturnType<typeof createMenuQueue> | null>(null);
  if (!queue.current) queue.current = createMenuQueue({ fetchMenu, onResult });
  useEffect(() => () => queue.current?.cancelAll(), []);

  const search = useCallback(async (area: SearchArea) => {
    const seq = ++searchSeq.current;
    lastArea.current = area;
    queue.current!.cancelAll();
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(area),
      });
      const json = (await res.json().catch(() => ({}))) as { cafes?: CafeResult[]; error?: string };
      if (seq !== searchSeq.current) return; // a newer search has started
      if (!res.ok || !json.cafes) {
        setCafes(stopLoading);
        setError(json.error ?? ru.searchFailed);
        return;
      }
      setCafes(rank(json.cafes.map((c) => ({ ...c, loading: !c.menu && !!c.token }))));
      for (const c of json.cafes) if (!c.menu && c.token) queue.current!.enqueue(c.placeId, c.token);
    } catch {
      if (seq === searchSeq.current) {
        setCafes(stopLoading);
        setError(ru.searchFailed);
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  const retry = useCallback(
    (placeId: string) => {
      const c = cafes.find((x) => x.placeId === placeId);
      if (!c?.failed) return;
      if (c.failed.expired || !c.token) {
        if (lastArea.current) void search(lastArea.current);
        return;
      }
      setCafes((prev) => prev.map((x) => (x.placeId === placeId ? { ...x, loading: true, failed: undefined } : x)));
      queue.current!.enqueue(placeId, c.token);
    },
    [cafes, search],
  );

  return { cafes, searching, error, search, retry };
}
