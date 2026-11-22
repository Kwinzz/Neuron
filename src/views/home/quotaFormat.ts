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
