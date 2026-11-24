import { useEffect, useRef, useState } from "react";
import { IS_LINUX } from "@/lib/platform";

/**
 * Minimum time between two updates. Each update re-parses the whole message as Markdown: fine at 60 fps in
 * WebView2, too heavy for WebKitGTK (Linux) → 20 updates per second there, with proportionally bigger steps.
 */
const MIN_UPDATE_MS = IS_LINUX ? 50 : 0;
/** Length of one display frame, to size the steps when updates are spaced out. */
const FRAME_MS = 1000 / 60;

/**
 * Reveals `target` progressively (one rAF step per frame) so text appears fluidly instead of in
 * network-sized chunks. The step grows with the backlog: a slow stream types steadily, a big block
 * (e.g. Codex, which sends whole messages) unrolls quickly without lagging behind.
 *
 * `animate` = false shows the text immediately (history).
 */
export function useSmoothText(target: string, animate: boolean): { text: string; revealing: boolean } {
  const [length, setLength] = useState(animate ? 0 : target.length);
  const lengthRef = useRef(length);

  useEffect(() => {
    if (!animate) {
      lengthRef.current = target.length;
      setLength(target.length);
      return;
    }
    if (lengthRef.current > target.length) {
      lengthRef.current = target.length; // text was replaced by something shorter
      setLength(target.length);
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const backlog = target.length - lengthRef.current;
      if (backlog <= 0) return;
      const elapsed = last === 0 ? FRAME_MS : now - last;
      if (elapsed < MIN_UPDATE_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      last = now;
      // Same speed whatever the update rate: one step per elapsed display frame.
      const frames = Math.max(1, Math.round(elapsed / FRAME_MS));
      const step = Math.max(2, Math.ceil(backlog / 14)) * frames;
      lengthRef.current = Math.min(target.length, lengthRef.current + step);
      setLength(lengthRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  const shown = Math.min(length, target.length);
  return { text: target.slice(0, shown), revealing: shown < target.length };
}
