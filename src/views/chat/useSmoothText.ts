import { useEffect, useRef, useState } from "react";
import { nextFrame } from "@/lib/frame";
import { IS_LINUX } from "@/lib/platform";

/**
 * Minimum time between two updates. Each update re-parses the whole message as Markdown: fine at 60 fps in
 * WebView2, too heavy for WebKitGTK (Linux) → 20 updates per second there, with proportionally bigger steps.
 */
const MIN_UPDATE_MS = IS_LINUX ? 50 : 0;
/** Length of one display frame, to size the steps when updates are spaced out. */
const FRAME_MS = 1000 / 60;
/** Most display frames one step may catch up on. */
const MAX_FRAMES = 6;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

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
  /** Time of the last step, kept across target changes (a new delta must not restart the update spacing). */
  const lastRef = useRef(0);

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
    let cancel = () => {};
    const tick = (now: number) => {
      const backlog = target.length - lengthRef.current;
      if (backlog <= 0) return;
      // The very first step goes right away. (Measuring it as one display frame made it shorter than
      // MIN_UPDATE_MS on Linux: it waited forever without `last` ever moving — the answer stayed blank, only
      // the caret showed, until the chat was reopened.)
      const elapsed = lastRef.current === 0 ? MIN_UPDATE_MS : now - lastRef.current;
      if (elapsed < MIN_UPDATE_MS) {
        cancel = nextFrame(tick);
        return;
      }
      lastRef.current = now;
      // Same speed whatever the update rate: one step per elapsed display frame (a pause in the stream
      // doesn't turn into one big jump).
      const frames = Math.min(MAX_FRAMES, Math.max(1, Math.round(elapsed / FRAME_MS)));
      const step = Math.max(2, Math.ceil(backlog / 14)) * frames;
      lengthRef.current = Math.min(target.length, lengthRef.current + step);
      setLength(lengthRef.current);
      cancel = nextFrame(tick);
    };
    cancel = nextFrame(tick);
    return () => cancel();
  }, [target, animate]);

  let shown = Math.min(length, target.length);
  // Never cut an emoji (UTF-16 surrogate pair) in half: it would flash as « � ».
  if (shown > 0 && shown < target.length && isHighSurrogate(target.charCodeAt(shown - 1))) shown -= 1;
  return { text: target.slice(0, shown), revealing: shown < target.length };
}
