"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CafeCard } from "@/components/CafeCard";
import { CafeMap } from "@/components/CafeMap";
import { MapPreview } from "@/components/MapPreview";
import { ChainFilter, useHideChains } from "@/components/ChainFilter";
import { useCafes } from "@/lib/client/useCafes";
import type { LatLng, Rect } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

export function EgglessApp() {
  const { cafes, searching, error, search, retry } = useCafes();
  const [hideChains, setHideChains] = useHideChains();
  const visible = hideChains ? cafes.filter((c) => !c.chain) : cafes;
  const allHidden = hideChains && cafes.length > 0 && visible.length === 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ at: LatLng; seq: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const bounds = useRef<Rect | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Full screen owns one history entry, so the phone's back gesture closes the map instead of leaving the site.
  const openFullscreen = () => {
    setFullscreen(true);
    // Reuse our entry if it is still there (back not processed yet), so entries never pile up.
    if (history.state?.eggMap) history.replaceState({ eggMap: true }, "");
    else history.pushState({ eggMap: true }, "");
  };
  const closeFullscreen = useCallback(() => {
    setFullscreen(false);
    setPreviewId(null);
    if (history.state?.eggMap) history.back();
  }, []);

  useEffect(() => {
    const onPop = () => {
      setFullscreen(false);
      setPreviewId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.body.style.overflow = fullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

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
      setNotice(ru.locationOff);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        panTo(at);
        setSearched(true);
        void search({ near: at });
      },
      () => setNotice(ru.locationOff),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const scrollToCard = (placeId: string) =>
    document.getElementById(`cafe-${placeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const selectPin = (placeId: string) => {
    setSelectedId(placeId);
    if (fullscreen) setPreviewId(placeId);
    else scrollToCard(placeId);
  };

  const preview = previewId ? visible.find((c) => c.placeId === previewId) : undefined;

  const message = error ?? notice;

  return (
    <main className="mx-auto max-w-xl">
      <div data-testid="map-container" className={fullscreen ? "fixed inset-0 z-40 h-dvh w-full bg-white" : "relative h-[40dvh] w-full"}>
        <CafeMap
          cafes={visible}
          selectedId={selectedId}
          focus={focus}
          onSelect={selectPin}
          onBoundsChange={(r) => (bounds.current = r)}
          onMapClick={() => setPreviewId(null)}
        />
        <button
          type="button"
          aria-label={fullscreen ? ru.closeMap : ru.fullscreen}
          onClick={fullscreen ? closeFullscreen : openFullscreen}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg text-stone-900 shadow-lg"
        >
          {fullscreen ? "✕" : "⤢"}
        </button>
        {fullscreen && preview && (
          <MapPreview
            cafe={preview}
            onMore={() => {
              closeFullscreen();
              setTimeout(() => scrollToCard(preview.placeId), 0);
            }}
          />
        )}
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2 px-4">
          <button
            type="button"
            onClick={searchArea}
            disabled={searching}
            className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-60"
          >
            {searching ? ru.searching : ru.searchArea}
          </button>
          <button
            type="button"
            onClick={nearMe}
            disabled={searching}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-900 shadow-lg disabled:opacity-60"
          >
            {ru.nearMe}
          </button>
        </div>
      </div>

      <section className="space-y-3 px-4 py-4">
        {message && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>}
        {!searched && !message && (
          <p className="text-sm text-stone-500">{ru.hint}</p>
        )}
        {cafes.length > 0 && (
          <div className="flex justify-end">
            <ChainFilter on={hideChains} onChange={setHideChains} />
          </div>
        )}
        {searched && !searching && !error && (cafes.length === 0 || allHidden) && (
          <p className="text-sm text-stone-500">{ru.noCafes}</p>
        )}
        {allHidden && (
          <button type="button" onClick={() => setHideChains(false)} className="text-sm text-stone-700 underline">
            {ru.showChains}
          </button>
        )}
        {visible.map((c) => (
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
