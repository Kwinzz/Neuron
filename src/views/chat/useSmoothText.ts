import { useEffect, useRef, useState } from "react";

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
    const tick = () => {
      const backlog = target.length - lengthRef.current;
      if (backlog <= 0) return;
      const step = Math.max(2, Math.ceil(backlog / 14));
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
