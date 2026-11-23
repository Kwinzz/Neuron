/**
 * WebView2 is a browser: some keys open browser UI over Neuron (Ctrl+F find bar, Ctrl+P print, F5 reload…).
 * Their default action is cancelled at the window level; Neuron's own handlers still receive the event.
 */
// Zoom (Ctrl + / - / 0) stays available.
const BLOCKED_CTRL = new Set(["f", "g", "p", "r", "u", "s", "h", "o"]);
const BLOCKED_KEYS = new Set(["F3", "F5", "F7", "BrowserBack", "BrowserForward", "BrowserRefresh"]);

function isBrowserShortcut(e: KeyboardEvent): boolean {
  if (BLOCKED_KEYS.has(e.key)) return true;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  // Ctrl+Shift+I / C: developer tools (already off in release builds); Ctrl+Shift+R: hard reload.
  if (e.shiftKey) return ["i", "c", "r"].includes(e.key.toLowerCase());
  return BLOCKED_CTRL.has(e.key.toLowerCase());
}

export function disableBrowserShortcuts(): void {
  window.addEventListener(
    "keydown",
    (e) => {
      if (isBrowserShortcut(e)) e.preventDefault();
    },
    { capture: true },
  );
}
