import type { ProviderUsage } from "@/bindings/ProviderUsage";
import type { QuotaUnit } from "@/bindings/QuotaUnit";
import type { WindowKind } from "@/bindings/WindowKind";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";

export const WINDOW_LABEL: Record<WindowKind, string> = {
  rolling_5h: "Fenêtre 5h",
  weekly: "7 jours",
  monthly: "30 jours",
  credits: "Crédits",
  none: "Cumul",
};

export const UNIT_LABEL: Record<QuotaUnit, string> = {
  tokens: "Tokens",
  messages: "Messages",
  usd: "USD",
  credits: "Crédits",
  requests: "Requêtes",
};

export const WINDOW_KINDS: readonly WindowKind[] = [
  "rolling_5h",
  "weekly",
  "monthly",
  "credits",
  "none",
];

export const QUOTA_UNITS: readonly QuotaUnit[] = [
  "tokens",
  "messages",
  "usd",
  "credits",
  "requests",
];

export function formatQuotaValue(value: number, unit: QuotaUnit): string {
  switch (unit) {
    case "tokens":
      return formatTokens(value);
    case "usd":
    case "credits":
      return formatCost(value);
    case "messages":
      return `${formatInteger(value)} msg`;
    case "requests":
      return `${formatInteger(value)} req`;
  }
}

export type QuotaLevel = "none" | "ok" | "warn" | "danger";

export function quotaLevel(ratio: number | null, alertPct: number): QuotaLevel {
  if (ratio == null) return "none";
  if (ratio >= 1) return "danger";
  if (ratio >= alertPct) return "warn";
  return "ok";
}

export const LEVEL_COLOR: Record<QuotaLevel, string> = {
  none: "var(--color-brand)",
  ok: "var(--color-brand)",
  warn: "var(--color-warn)",
  danger: "var(--color-danger)",
};

export const LEVEL_FILL: Record<QuotaLevel, string> = {
  none: "bg-brand",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

export const LEVEL_TEXT: Record<QuotaLevel, string> = {
  none: "text-fg-muted",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

/**
 * Ratio shown for a quota: the provider-reported subscription utilization when known (Claude 5h/7d
 * windows), else used / configured limit.
 */
export function effectiveRatio(usage: ProviderUsage): number | null {
  return usage.live?.utilization ?? usage.ratio;
}

export function effectiveResetsAt(usage: ProviderUsage): number | null {
  return usage.live?.resetsAt ?? usage.resetsAt;
}

export function pickTopProvider(list: readonly ProviderUsage[] | undefined): ProviderUsage | null {
  if (!list || list.length === 0) return null;

  let bestWithRatio: ProviderUsage | null = null;
  for (const item of list) {
    const r = effectiveRatio(item);
    if (r != null) {
      if (bestWithRatio === null || r > (effectiveRatio(bestWithRatio) ?? -1)) {
        bestWithRatio = item;
      }
    }
  }
  if (bestWithRatio !== null) return bestWithRatio;

  let bestByUsed: ProviderUsage | null = list[0] ?? null;
  for (const item of list) {
    if (bestByUsed === null || item.used > bestByUsed.used) {
      bestByUsed = item;
    }
  }
  return bestByUsed;
}
