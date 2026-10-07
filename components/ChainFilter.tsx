"use client";

import { useCallback, useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";

const KEY = "eggless.hideChains";

// Remembered per device; blocked storage (private mode) just means the choice lasts for this visit.
export function useHideChains(): [boolean, (v: boolean) => void] {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    try {
      setHide(localStorage.getItem(KEY) === "1");
    } catch {
      // storage unavailable
    }
  }, []);
  const update = useCallback((v: boolean) => {
    setHide(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // storage unavailable
    }
  }, []);
  return [hide, update];
}

export function ChainFilter({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700"}`}
    >
      {ru.hideChains}
    </button>
  );
}
