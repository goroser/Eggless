"use client";

import { useState } from "react";
import { headline } from "@/lib/client/format";
import type { CafeState } from "@/lib/client/useCafes";
import type { Dish } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";
import { CafePhotos } from "@/components/CafePhotos";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Russian name as the main line, the menu's English underneath (that is what to say at the counter).
function DishName({ d }: { d: Dish }) {
  const ruName = d.nameRu.trim();
  if (!ruName || same(ruName, d.name)) return <span>{d.name}</span>;
  return (
    <span className="flex flex-col">
      <span>{ruName}</span>
      <span className="text-xs text-stone-500">{d.name}</span>
    </span>
  );
}

function DishItem({ d, withDescription = false }: { d: Dish; withDescription?: boolean }) {
  const description = d.descriptionRu.trim() || d.description.trim();
  return (
    <li className={`flex justify-between gap-3 py-0.5 ${d.substantial ? "" : "text-stone-400"}`}>
      <span className="flex flex-col">
        <DishName d={d} />
        {withDescription && description && <span className="text-xs text-stone-500">{description}</span>}
      </span>
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
            <DishItem key={i} d={d} withDescription />
          ))}
        </ul>
      )}
      {adaptable.length > 0 && (
        <div>
          <h4 className="font-medium text-amber-700">{ru.askWithoutEgg}</h4>
          <ul>
            {adaptable.map((d, i) => (
              <DishItem key={i} d={d} withDescription />
            ))}
          </ul>
        </div>
      )}
      {egg.length > 0 && (
        <div>
          <button type="button" className="text-stone-500 underline" onClick={() => setShowEgg((v) => !v)}>
            {ru.eggHidden(egg.length)}
          </button>
          {showEgg && (
            <ul className="mt-1 text-stone-400 line-through decoration-stone-300">
              {egg.map((d, i) => (
                <li key={i}>
                  <DishName d={d} />
                </li>
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
  const head = cafe.failed ? { main: ru.failed } : cafe.loading ? { main: ru.reading } : headline(menu);
  const served = menu?.status === "ok" ? ru.servedUntil(menu.servedUntil) : null;
  const isOk = !cafe.failed && menu?.status === "ok";
  const top = isOk ? menu.dishes.filter((d) => d.eggStatus === "no_egg" && d.substantial).slice(0, 3) : [];

  return (
    <article id={`cafe-${cafe.placeId}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <button type="button" onClick={onSelect} className="text-left text-base font-semibold">
            {cafe.name}
          </button>
          {cafe.chain && <span className="rounded bg-stone-100 px-1.5 text-xs text-stone-500">{ru.chain}</span>}
        </span>
        <div className="shrink-0 text-xs text-stone-500">
          {cafe.rating !== undefined && (
            <span>
              {cafe.rating}
              {cafe.userRatingCount !== undefined && ` (${cafe.userRatingCount})`}
            </span>
          )}
          {cafe.openNow !== undefined && (
            <span className={`ml-2 ${cafe.openNow ? "text-green-700" : "text-stone-500"}`}>
              {cafe.openNow ? ru.openNow : ru.closed}
            </span>
          )}
        </div>
      </header>

      <CafePhotos imageUrl={menu?.imageUrl ?? null} photos={cafe.photos} name={cafe.name} pending={cafe.loading} />

      <p className={`mt-1 ${cafe.loading ? "animate-pulse text-stone-400" : ""}`}>
        <span className={isOk ? "text-lg font-bold text-green-800" : "text-stone-500"}>{head.main}</span>
        {head.extra && <span className="ml-2 text-sm text-amber-700">{head.extra}</span>}
      </p>

      {cafe.failed && (
        <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-stone-300 px-3 py-1 text-sm">
          {ru.retry}
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
            {expanded ? ru.hideMenu : ru.showMenu}
          </button>
          {expanded && <FullMenu dishes={menu.dishes} />}
        </>
      )}

      <footer className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
        {menu?.extractedAt && menu.status !== "pending" && (
          <span>
            {ru.menuRead(menu.extractedAt)}
            {served && ` · ${served}`}
          </span>
        )}
        {menu?.sourceUrl && (
          <a href={menu.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            {ru.sourceMenu}
          </a>
        )}
        <a href={cafe.googleMapsUri} target="_blank" rel="noreferrer" className="underline">
          {ru.googleMaps}
        </a>
      </footer>
    </article>
  );
}
