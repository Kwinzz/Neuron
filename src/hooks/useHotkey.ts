import { useEffect, useRef } from "react";

export interface HotkeyOptions {
  /** Fire even when focus is in an input/textarea (default true for mod-combos). */
  allowInInputs?: boolean;
  enabled?: boolean;
}

/**
 * Global keyboard shortcut. `combo` examples: "mod+k", "mod+j", "escape".
 * `mod` = Ctrl on Windows/Linux, ⌘ on macOS.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, options: HotkeyOptions = {}): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { enabled = true } = options;
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const needMod = parts.includes("mod");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const allowInInputs = options.allowInInputs ?? needMod;

  useEffect(() => {
    if (!enabled) return;
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod !== needMod || e.shiftKey !== needShift || e.altKey !== needAlt) return;
      if (e.key.toLowerCase() !== key) return;
      if (!allowInInputs) {
        const target = e.target as HTMLElement | null;
        if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      }
      e.preventDefault();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, key, needMod, needShift, needAlt, allowInInputs]);
}
