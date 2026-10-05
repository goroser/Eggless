"use client";

import { useCallback, useRef, useState } from "react";
import { CafeCard } from "@/components/CafeCard";
import { CafeMap } from "@/components/CafeMap";
import { useCafes } from "@/lib/client/useCafes";
import type { LatLng, Rect } from "@/lib/types";

export function EgglessApp() {
  const { cafes, searching, error, search, retry } = useCafes();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ at: LatLng; seq: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const bounds = useRef<Rect | null>(null);

  const panTo = useCallback((at: LatLng) => setFocus((f) => ({ at, seq: (f?.seq ?? 0) + 1 })), []);

  const searchArea = () => {
    if (!bounds.current) return;
    setNotice(null);
    setSearched(true);
    void search({ rect: bounds.current });
  };

  const nearMe = () => {
    setNotice(null);
    if (!navigator.geolocation) {
      setNotice("Location is off; pan the map and tap Search this area");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        panTo(at);
        setSearched(true);
        void search({ near: at });
      },
      () => setNotice("Location is off; pan the map and tap Search this area"),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const selectPin = (placeId: string) => {
    setSelectedId(placeId);
    document.getElementById(`cafe-${placeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const message = error ?? notice;

  return (
    <main className="mx-auto max-w-xl">
      <div className="relative h-[40dvh] w-full">
        <CafeMap
          cafes={cafes}
          selectedId={selectedId}
          focus={focus}
          onSelect={selectPin}
          onBoundsChange={(r) => (bounds.current = r)}
        />
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2 px-4">
          <button
            type="button"
            onClick={searchArea}
            disabled={searching}
            className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search this area"}
          </button>
          <button
            type="button"
            onClick={nearMe}
            disabled={searching}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-900 shadow-lg disabled:opacity-60"
          >
            Near me
          </button>
        </div>
      </div>

      <section className="space-y-3 px-4 py-4">
        {message && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>}
        {!searched && !message && (
          <p className="text-sm text-stone-500">Tap Near me, or move the map and tap Search this area.</p>
        )}
        {searched && !searching && !error && cafes.length === 0 && (
          <p className="text-sm text-stone-500">No cafés found here</p>
        )}
        {cafes.map((c) => (
          <CafeCard
            key={c.placeId}
            cafe={c}
            onRetry={() => retry(c.placeId)}
            onSelect={() => {
              setSelectedId(c.placeId);
              panTo(c.location);
            }}
          />
        ))}
      </section>
    </main>
  );
}
