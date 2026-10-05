"use client";

import { useState } from "react";
import { headline } from "@/lib/client/format";
import type { CafeState } from "@/lib/client/useCafes";
import type { Dish } from "@/lib/types";

const readDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

function DishItem({ d }: { d: Dish }) {
  return (
    <li className={`flex justify-between gap-3 py-0.5 ${d.substantial ? "" : "text-stone-400"}`}>
      <span>{d.name}</span>
      {d.price && <span className="shrink-0 tabular-nums text-stone-500">{d.price}</span>}
    </li>
  );
}

function FullMenu({ dishes }: { dishes: Dish[] }) {
  const [showEgg, setShowEgg] = useState(false);
  const noEgg = dishes.filter((d) => d.eggStatus === "no_egg");
  const adaptable = dishes.filter((d) => d.eggStatus === "egg_component");
  const egg = dishes.filter((d) => d.eggStatus === "egg_main");
  return (
    <div data-testid="full-menu" className="mt-3 space-y-3 text-sm">
      {noEgg.length > 0 && (
        <ul>
          {noEgg.map((d, i) => (
            <DishItem key={i} d={d} />
          ))}
        </ul>
      )}
      {adaptable.length > 0 && (
        <div>
          <h4 className="font-medium text-amber-700">Ask without egg</h4>
          <ul>
            {adaptable.map((d, i) => (
              <DishItem key={i} d={d} />
            ))}
          </ul>
        </div>
      )}
      {egg.length > 0 && (
        <div>
          <button type="button" className="text-stone-500 underline" onClick={() => setShowEgg((v) => !v)}>
            {egg.length} egg dishes hidden
          </button>
          {showEgg && (
            <ul className="mt-1 text-stone-400 line-through decoration-stone-300">
              {egg.map((d, i) => (
                <li key={i}>{d.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function CafeCard({ cafe, onRetry, onSelect }: { cafe: CafeState; onRetry: () => void; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const menu = cafe.menu;
  const head = cafe.failed ? { main: "Couldn't read the menu" } : cafe.loading ? { main: "Reading the menu…" } : headline(menu);
  const isOk = !cafe.failed && menu?.status === "ok";
  const top = isOk ? menu.dishes.filter((d) => d.eggStatus === "no_egg" && d.substantial).slice(0, 3) : [];

  return (
    <article id={`cafe-${cafe.placeId}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <button type="button" onClick={onSelect} className="text-left text-base font-semibold">
          {cafe.name}
        </button>
        <div className="shrink-0 text-xs text-stone-500">
          {cafe.rating !== undefined && (
            <span>
              {cafe.rating}
              {cafe.userRatingCount !== undefined && ` (${cafe.userRatingCount})`}
            </span>
          )}
          {cafe.openNow !== undefined && (
            <span className={`ml-2 ${cafe.openNow ? "text-green-700" : "text-stone-500"}`}>
              {cafe.openNow ? "Open now" : "Closed"}
            </span>
          )}
        </div>
      </header>

      <p className={`mt-1 ${cafe.loading ? "animate-pulse text-stone-400" : ""}`}>
        <span className={isOk ? "text-lg font-bold text-green-800" : "text-stone-500"}>{head.main}</span>
        {head.extra && <span className="ml-2 text-sm text-amber-700">{head.extra}</span>}
      </p>

      {cafe.failed && (
        <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-stone-300 px-3 py-1 text-sm">
          Retry
        </button>
      )}

      {top.length > 0 && (
        <ul data-testid="top-dishes" className="mt-2 text-sm">
          {top.map((d, i) => (
            <DishItem key={i} d={d} />
          ))}
        </ul>
      )}

      {isOk && menu.dishes.length > 0 && (
        <>
          <button type="button" className="mt-2 text-sm text-stone-600 underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide full menu" : "Show full menu"}
          </button>
          {expanded && <FullMenu dishes={menu.dishes} />}
        </>
      )}

      <footer className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
        {menu?.extractedAt && menu.status !== "pending" && (
          <span>
            Menu read {readDate(menu.extractedAt)}
            {menu.servedUntil && ` · served ${menu.servedUntil.replace(/^served\s+/i, "")}`}
          </span>
        )}
        {menu?.sourceUrl && (
          <a href={menu.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            Source menu
          </a>
        )}
        <a href={cafe.googleMapsUri} target="_blank" rel="noreferrer" className="underline">
          Google Maps
        </a>
      </footer>
    </article>
  );
}
