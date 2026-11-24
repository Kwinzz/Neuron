/**
 * `requestIdleCallback` with a fallback: WebView2 (Windows) has it, WebKitGTK (Linux) does not.
 * Returns the matching cancel function.
 */
export function whenIdle(callback: () => void, timeoutMs: number): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  // No idle signal: wait a moment so the first render and the initial IPC calls go first.
  const id = window.setTimeout(callback, Math.min(timeoutMs, 500));
  return () => window.clearTimeout(id);
}
