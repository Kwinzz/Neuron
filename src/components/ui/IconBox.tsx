import type { ReactNode } from "react";

type IconBoxTone = "brand" | "muted" | "ok" | "warn" | "danger" | "cyan";

const TONE: Record<IconBoxTone, string> = {
  brand: "bg-brand text-brand-fg",
  muted: "bg-surface text-hl",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  cyan: "bg-hl-2/15 text-hl-2",
};

const SIZE = { 24: "size-6 rounded-sm", 30: "size-[30px] rounded-md", 36: "size-9 rounded-md", 45: "size-[45px] rounded-md" } as const;

interface IconBoxProps {
  children: ReactNode;
  tone?: IconBoxTone;
  size?: keyof typeof SIZE;
  className?: string;
}

/** Vision icon box: rounded square holding an icon. */
export function IconBox({ children, tone = "brand", size = 30, className = "" }: IconBoxProps) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${SIZE[size]} ${TONE[tone]} ${className}`} aria-hidden>
      {children}
    </span>
  );
}
