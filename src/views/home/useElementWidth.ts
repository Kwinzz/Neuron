import { useCallback, useEffect, useState } from "react";

/**
 * Content-box width of an element, kept in sync with a ResizeObserver.
 * Returns a *callback ref* so the observer follows the element even when the consumer swaps the node
 * it is attached to (e.g. empty state ↔ chart frame).
 */
export function useElementWidth<T extends HTMLElement>(
  initialWidth = 640,
): [(el: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number>(initialWidth);

  const ref = useCallback((el: T | null) => setElement(el), []);

  useEffect(() => {
    if (!element) return;
    const update = (w: number) => {
      const next = Math.round(w);
      if (next > 0) setWidth((prev) => (prev === next ? prev : next));
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}
