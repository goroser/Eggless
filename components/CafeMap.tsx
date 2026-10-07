"use client";

import { AdvancedMarker, APIProvider, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import type { CafeState } from "@/lib/client/useCafes";
import { pinColor } from "@/lib/menu/score";
import type { LatLng, Rect } from "@/lib/types";

export const CHISWICK: LatLng = { lat: 51.492, lng: -0.26 };

const COLORS = { green: "#16a34a", amber: "#d97706", red: "#dc2626", grey: "#9ca3af" } as const;

// Pans the map whenever `focus` changes (a card was tapped, or "Near me" found the user).
function FocusController({ focus }: { focus: { at: LatLng; seq: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (map && focus) map.panTo(focus.at);
  }, [map, focus]);
  return null;
}

export function CafeMap({
  cafes,
  selectedId,
  focus,
  onSelect,
  onBoundsChange,
  onMapClick,
}: {
  cafes: CafeState[];
  selectedId: string | null;
  focus: { at: LatLng; seq: number } | null;
  onSelect: (placeId: string) => void;
  onBoundsChange: (r: Rect) => void;
  onMapClick?: () => void;
}) {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}>
      <Map
        className="h-full w-full"
        defaultCenter={CHISWICK}
        defaultZoom={15}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAP_ID}
        gestureHandling="greedy"
        disableDefaultUI
        onClick={() => onMapClick?.()}
        onBoundsChanged={(e) => {
          const b = e.detail.bounds;
          onBoundsChange({ low: { lat: b.south, lng: b.west }, high: { lat: b.north, lng: b.east } });
        }}
      >
        <FocusController focus={focus} />
        {cafes.map((c) => {
          const color = COLORS[c.failed || c.loading ? "grey" : pinColor(c.menu)];
          const selected = c.placeId === selectedId;
          return (
            <AdvancedMarker key={c.placeId} position={c.location} title={c.name} onClick={() => onSelect(c.placeId)} zIndex={selected ? 10 : 1}>
              {/* Chains get a hollow look: white centre; independents a solid one. */}
              <Pin
                background={c.chain ? "#ffffff" : color}
                borderColor={selected ? "#1c1917" : color}
                glyphColor={c.chain ? color : "#ffffff"}
                scale={selected ? 1.2 : 1}
              />
            </AdvancedMarker>
          );
        })}
      </Map>
    </APIProvider>
  );
}
