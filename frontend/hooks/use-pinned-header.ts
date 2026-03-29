"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether a sticky header has crossed a scroll threshold,
 * and measures its height via ResizeObserver.
 */
export function usePinnedHeader(deps: unknown[] = []) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  const [isPinned, setIsPinned] = useState(false);

  // Measure header height
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      setHeight(Math.round(header.getBoundingClientRect().height));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Track pinned state via scroll/resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stickyTop = 12;
    const updatePinned = () => {
      const next = container.getBoundingClientRect().top <= stickyTop;
      setIsPinned((prev) => (prev === next ? prev : next));
    };

    updatePinned();
    window.addEventListener("scroll", updatePinned, { passive: true });
    window.addEventListener("resize", updatePinned);

    return () => {
      window.removeEventListener("scroll", updatePinned);
      window.removeEventListener("resize", updatePinned);
    };
  }, []);

  return { containerRef, headerRef, height, isPinned } as const;
}
