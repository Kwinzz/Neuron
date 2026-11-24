import type { ProviderUsage } from "@/bindings/ProviderUsage";
import type { QuotaUnit } from "@/bindings/QuotaUnit";
import type { WindowKind } from "@/bindings/WindowKind";
import { t } from "@/i18n";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";

/** Getters: the labels follow the interface language. */
export const WINDOW_LABEL: Record<WindowKind, string> = {
  get rolling_5h() {
    return t("home.window5h");
  },
  get weekly() {
    return t("home.range7d");
  },
  get monthly() {
    return t("home.range30d");
  },
  get credits() {
    return t("home.credits");
  },
  get none() {
    return t("home.windowCumulative");
  },
};

export const UNIT_LABEL: Record<QuotaUnit, string> = {
  get tokens() {
    return t("home.unitTokens");
  },
  get messages() {
    return t("home.unitMessages");
  },
  usd: "USD",
  get credits() {
    return t("home.credits");
  },
  get requests() {
    return t("home.unitRequests");
  },
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
