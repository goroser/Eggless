"use client";

import { CafePhotos } from "@/components/CafePhotos";
import { headline } from "@/lib/client/format";
import type { CafeState } from "@/lib/client/useCafes";
import { ru } from "@/lib/i18n/ru";

// Bottom sheet for a tapped pin while the map is full screen.
export function MapPreview({ cafe, onMore }: { cafe: CafeState; onMore: () => void }) {
  const head = cafe.failed ? { main: ru.failed } : cafe.loading ? { main: ru.reading } : headline(cafe.menu);
  return (
    <div data-testid="map-preview" className="absolute inset-x-3 bottom-20 z-10 rounded-xl bg-white p-4 shadow-xl">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{cafe.name}</span>
        {cafe.chain && <span className="rounded bg-stone-100 px-1.5 text-xs text-stone-500">{ru.chain}</span>}
      </div>
      <p className="mt-1">
        <span className={cafe.menu?.status === "ok" ? "font-bold text-green-800" : "text-stone-500"}>{head.main}</span>
        {head.extra && <span className="ml-2 text-sm text-amber-700">{head.extra}</span>}
      </p>
      <CafePhotos imageUrl={cafe.menu?.imageUrl ?? null} photos={cafe.photos.slice(0, 1)} name={cafe.name} />
      <button type="button" onClick={onMore} className="mt-3 text-sm font-medium text-stone-900 underline">
        {ru.more}
      </button>
    </div>
  );
}
