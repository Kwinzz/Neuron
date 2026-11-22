import type { ReactNode } from "react";

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

/** Platform-aware modifier label. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface px-1.5 font-sans text-[10px] font-bold leading-none text-fg-muted ${className}`}
    >
      {children}
    </kbd>
  );
}
