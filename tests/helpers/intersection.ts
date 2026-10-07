import { vi } from "vitest";

// jsdom has no IntersectionObserver; this stand-in lets a test decide when an element "scrolls into view".
export function stubIntersectionObserver() {
  const observers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];
  class FakeIO {
    constructor(private cb: IntersectionObserverCallback) {
      observers.push({ cb, els: [] });
    }
    observe(el: Element) {
      observers.find((o) => o.cb === this.cb)!.els.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeIO);
  return {
    showAll() {
      for (const o of observers) {
        o.cb(o.els.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver);
      }
    },
  };
}
