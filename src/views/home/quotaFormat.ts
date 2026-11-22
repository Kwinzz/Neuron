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

export const LEVEL_FILL: Record<QuotaLevel, string> = {
  none: "*:data-[slot=progress-indicator]:bg-primary",
  ok: "*:data-[slot=progress-indicator]:bg-ok",
  warn: "*:data-[slot=progress-indicator]:bg-warn",
  danger: "*:data-[slot=progress-indicator]:bg-destructive",
};

export const LEVEL_TEXT: Record<QuotaLevel, string> = {
  none: "text-muted-foreground",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-destructive",
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
