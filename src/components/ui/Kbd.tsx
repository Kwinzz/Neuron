import type { ReactNode } from "react";

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

/** Platform-aware modifier label. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-line bg-bg-sunken px-1 font-mono text-[10px] leading-none text-fg-subtle ${className}`}
    >
      {children}
    </kbd>
  );
}
