/**
 * `requestAnimationFrame` with a timer safety net. WebKitGTK (Linux) can stop running rAF callbacks for a while
 * (window hidden or occluded, compositor hiccups): whatever waited on the next frame froze — a chat whose answer
 * never showed until the view was reopened. Whichever fires first runs `callback`, once.
 * Returns the cancel function.
 */
export function nextFrame(callback: (now: number) => void, fallbackMs = 100): () => void {
  let done = false;
  const cancel = () => {
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
  };
  const run = (now: number) => {
    if (done) return;
    cancel();
    callback(now);
  };
  const raf = requestAnimationFrame(run);
  const timer = window.setTimeout(() => run(performance.now()), fallbackMs);
  return cancel;
}
