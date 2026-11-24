import type { UsageSums } from "@/bindings/UsageSums";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";

export type UsageMetric = "tokens" | "cost" | "turns";

const usdAxis = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  notation: "compact",
  maximumFractionDigits: 1,
});

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
    label: "Tokens",
    unit: "tokens (cache compris)",
    // Same count as « Tokens au total » and the providers' dashboards: cache reads and writes included.
    value: (s) => s.input + s.output + s.cacheRead + s.cacheWrite,
    format: formatTokens,
    axis: formatTokens,
    integer: true,
  },
  cost: {
    label: "Coût",
    unit: "",
    value: (s) => s.costUsd,
    format: formatCost,
    axis: (n) => (n === 0 ? "0" : n < 1 ? formatCost(n) : usdAxis.format(n)),
    integer: false,
  },
  turns: {
    label: "Requêtes",
    unit: "requêtes",
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
