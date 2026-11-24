import type { UsageSums } from "@/bindings/UsageSums";
import { t } from "@/i18n";
import { formatCost, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { computeDelta } from "./computeDelta";
import { KpiCard } from "./KpiCard";

/** Every token, all providers: input + output + cache reads + cache writes. */
const allTokens = (u: UsageSums) => u.input + u.output + u.cacheRead + u.cacheWrite;

export function SectionCards() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const totals = usage?.totals;
  const prev = usage?.previous;

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <KpiCard
        index={0}
        label={t("home.kpiInput")}
        value={totals ? formatTokens(totals.input) : "—"}
        delta={totals && prev ? computeDelta(totals.input, prev.input) : null}
        hint={t("home.kpiInputHint")}
        loading={isLoading}
      />
      <KpiCard
        index={1}
        label={t("home.kpiOutput")}
        value={totals ? formatTokens(totals.output) : "—"}
        delta={totals && prev ? computeDelta(totals.output, prev.output) : null}
        hint={t("home.kpiOutputHint")}
        loading={isLoading}
      />
      <KpiCard
        index={2}
        label={t("home.kpiCost")}
        value={totals ? formatCost(totals.costUsd) : "—"}
        delta={totals && prev ? computeDelta(totals.costUsd, prev.costUsd) : null}
        hint={t("home.kpiCostHint")}
        loading={isLoading}
      />
      <KpiCard
        index={3}
        label={t("home.kpiTotal")}
        value={totals ? formatTokens(allTokens(totals)) : "—"}
        delta={totals && prev ? computeDelta(allTokens(totals), allTokens(prev)) : null}
        hint={t("home.kpiTotalHint")}
        loading={isLoading}
      />
    </div>
  );
}
