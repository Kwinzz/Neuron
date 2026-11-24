import type { UsageSums } from "@/bindings/UsageSums";
import { locale, t } from "@/i18n";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";

export type UsageMetric = "tokens" | "cost" | "turns";

let usdAxisCache: { locale: string; format: Intl.NumberFormat } | null = null;

/** Compact dollar formatter for the Y axis, rebuilt when the interface language changes. */
function usdAxis(): Intl.NumberFormat {
  const current = locale();
  if (usdAxisCache?.locale !== current) {
    usdAxisCache = {
      locale: current,
      format: new Intl.NumberFormat(current, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    };
  }
  return usdAxisCache.format;
}

interface MetricSpec {
  /** Toggle label. */
  label: string;
  /** Unit word for the card description ("1,2 M tokens"). */
  unit: string;
  value: (sums: UsageSums) => number;
  format: (n: number) => string;
  /** Short form for the Y axis. */
  axis: (n: number) => string;
  /** Integer-only axis ticks. */
  integer: boolean;
}

export const METRICS: Record<UsageMetric, MetricSpec> = {
  tokens: {
    get label() {
      return t("home.metricTokens");
    },
    get unit() {
      return t("home.metricTokensUnit");
    },
    // Same count as « Tokens au total » and the providers' dashboards: cache reads and writes included.
    value: (s) => s.input + s.output + s.cacheRead + s.cacheWrite,
    format: formatTokens,
    axis: formatTokens,
    integer: true,
  },
  cost: {
    get label() {
      return t("home.metricCost");
    },
    unit: "",
    value: (s) => s.costUsd,
    format: formatCost,
    axis: (n) => (n === 0 ? "0" : n < 1 ? formatCost(n) : usdAxis().format(n)),
    integer: false,
  },
  turns: {
    get label() {
      return t("home.metricTurns");
    },
    get unit() {
      return t("home.metricTurnsUnit");
    },
    value: (s) => s.turns,
    format: formatInteger,
    axis: formatTokens,
    integer: true,
  },
};

export const METRIC_ORDER: readonly UsageMetric[] = ["tokens", "cost", "turns"];

export function isUsageMetric(v: string): v is UsageMetric {
  return v === "tokens" || v === "cost" || v === "turns";
}
