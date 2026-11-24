import { memo } from "react";
import { cn } from "cn";
import { useNow } from "@/hooks/useNow";
import { locale, t } from "@/i18n";
import { formatCountdown, formatPercent } from "@/lib/format";
import type { QuotaLevel } from "./quotaFormat";

/** Translucent fill per level: the labels inside the bar stay readable on the filled and the empty part. */
const FILL: Record<QuotaLevel, string> = {
  none: "bg-primary/25",
  ok: "bg-ok/30",
  warn: "bg-warn/35",
  danger: "bg-destructive/40",
};
const EDGE: Record<QuotaLevel, string> = {
  none: "bg-primary",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-destructive",
};

interface QuotaBarProps {
  /** 0–1 (may exceed 1). */
  ratio: number;
  resetsAt: number | null;
  level: QuotaLevel;
  label: string;
  className?: string;
}

/** Quota bar with the percentage inside on the left and the time before reset inside on the right. */
export const QuotaBar = memo(function QuotaBar({ ratio, resetsAt, level, label, className }: QuotaBarProps) {
  const now = useNow(60_000);
  const width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className={cn("relative h-6 overflow-hidden rounded-md bg-muted", className)}
    >
      <div
        className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 ease-snappy", FILL[level])}
        style={{ width }}
      >
        <div className={cn("absolute inset-y-0 right-0 w-0.5", EDGE[level])} />
      </div>
      <div className="relative flex h-full items-center justify-between gap-2 px-2 font-mono text-xs tabular-nums">
        <span className="font-medium text-foreground">{formatPercent(ratio)}</span>
        {resetsAt != null && (
          <span className="truncate text-muted-foreground" title={new Date(resetsAt).toLocaleString(locale())}>
            {t("home.resetIn")} <span className="text-foreground">{formatCountdown(resetsAt - now)}</span>
          </span>
        )}
      </div>
    </div>
  );
});
