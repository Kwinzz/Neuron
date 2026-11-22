import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 120;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
}

export interface StickToBottom {
  showPill: boolean;
  scrollToBottom: (smooth?: boolean) => void;
}

/**
 * Keeps a scroll container pinned to the bottom while content grows,
 * pausing auto-scroll when the user scrolls up and exposing a "new messages" pill trigger.
 */
export function useStickToBottom(
  root: HTMLElement | null,
  contentRef: RefObject<HTMLElement | null>,
): StickToBottom {
  const [showPill, setShowPill] = useState(false);
  const atBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!root) return;

    // Only an UPWARD scroll can unstick: content growth and our own (smooth) scroll-to-bottom move
    // scrollTop down or not at all, so their intermediate scroll events never pause auto-follow.
    let lastTop = root.scrollTop;
    const onScroll = () => {
      const top = root.scrollTop;
      const movedUp = top < lastTop - 1;
      lastTop = top;
      if (isNearBottom(root)) {
        atBottomRef.current = true;
        setShowPill(false);
      } else if (movedUp) {
        atBottomRef.current = false;
      }
    };

    root.addEventListener("scroll", onScroll, { passive: true });

    const content = contentRef.current;
    let observer: ResizeObserver | null = null;
    if (content) {
      let prevHeight = content.getBoundingClientRect().height;
      observer = new ResizeObserver((entries) => {
        const nextHeight = entries[0]?.contentRect.height ?? content.getBoundingClientRect().height;
        const grew = nextHeight > prevHeight;
        prevHeight = nextHeight;

        if (!atBottomRef.current && !grew) return;

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (atBottomRef.current) {
            root.scrollTop = root.scrollHeight;
          } else if (grew && !isNearBottom(root)) {
            setShowPill(true);
          }
        });
      });
      observer.observe(content);
    }

    return () => {
      root.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [root, contentRef]);

  const scrollToBottom = useCallback(
    (smooth = false) => {
      if (!root) return;
      atBottomRef.current = true;
      setShowPill(false);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        root.scrollTo({
          top: root.scrollHeight,
          behavior: smooth ? "smooth" : "auto",
        });
      });
    },
    [root],
  );

  return { showPill, scrollToBottom };
}
