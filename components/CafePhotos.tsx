"use client";

import { useEffect, useRef, useState } from "react";
import type { PhotoRef } from "@/lib/types";

type Shown = { src: string; large: string; attribution?: PhotoRef["attribution"]; key: string };

const googleSrc = (ref: string, w: number) => `/api/photo?t=${encodeURIComponent(ref)}&w=${w}`;

// Website share image first; Google photos only if that is missing or broken, and only once the card is on screen.
export function CafePhotos({ imageUrl, photos, name }: { imageUrl: string | null; photos: PhotoRef[]; name: string }) {
  const [websiteFailed, setWebsiteFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Shown | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  const useWebsite = !!imageUrl && !websiteFailed;
  const wantsGoogle = !useWebsite && photos.length > 0;

  useEffect(() => {
    if (!wantsGoogle || visible || !holder.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(holder.current);
    return () => io.disconnect();
  }, [wantsGoogle, visible]);

  const shown: Shown[] = useWebsite
    ? [{ src: imageUrl!, large: imageUrl!, key: "site" }]
    : visible
      ? photos
          .filter((p) => !failed.has(p.ref))
          .map((p) => ({ src: googleSrc(p.ref, 400), large: googleSrc(p.ref, 800), attribution: p.attribution, key: p.ref }))
      : [];

  if (!useWebsite && !wantsGoogle) return null;
  if (wantsGoogle && visible && shown.length === 0) return null;
  if (shown.length === 0) return <div ref={holder} className="h-px" aria-hidden />;

  return (
    <>
      <div ref={holder} className="mt-3 flex gap-2">
        {shown.map((s) => (
          <figure key={s.key} className="relative m-0 h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-stone-100">
            <button type="button" aria-label={name} onClick={() => setOpen(s)} className="h-full w-full">
              <img
                src={s.src}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
                onError={() =>
                  s.key === "site" ? setWebsiteFailed(true) : setFailed((prev) => new Set(prev).add(s.key))
                }
              />
            </button>
            {s.attribution?.name && (
              <a
                href={s.attribution.uri || undefined}
                target="_blank"
                rel="noreferrer"
                className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1 text-[9px] text-white"
              >
                {s.attribution.name}
              </a>
            )}
          </figure>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-label={name} onClick={() => setOpen(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <img src={open.large} alt="" referrerPolicy="no-referrer" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}
