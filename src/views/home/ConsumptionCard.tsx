import { BarChart3, Table2 } from "lucide-react";
import { cn } from "cn";
import { useState } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import { bucketTitle } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { AgentTotals } from "./AgentTotals";
import { RANGE_LABEL } from "./rangeLabel";
import { UsageBarChart } from "./UsageBarChart";
import { UsageTable } from "./UsageTable";
import { isUsageMetric, METRIC_ORDER, METRICS, type UsageMetric } from "./usageMetric";
import { useUsageChartData } from "./useUsageChartData";

const EMPTY_BUCKETS: never[] = [];

export function ConsumptionCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;
  const [tableMode, setTableMode] = useState(false);
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const [hidden, setHidden] = useState<ReadonlySet<AgentKind>>(() => new Set());

  // While another period loads, the previous one stays on screen (dimmed) and keeps its own labels.
  const shownRange = usage?.range ?? range;
  const refreshing = usage !== undefined && usage.range !== range;

  const { rows, visibleAgents, totals, config, grandTotal, visibleTotal, peak } = useUsageChartData(
    usage?.buckets ?? EMPTY_BUCKETS,
    metric,
    hidden,
  );
  const spec = METRICS[metric];

  const toggleAgent = (agent: AgentKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(agent)) next.add(agent);
      return next;
    });

  const description = usage
    ? [
        `${spec.format(visibleTotal)}${spec.unit ? ` ${spec.unit}` : ""}`,
        RANGE_LABEL[shownRange],
        peak && visibleAgents.length > 0 && rows.length > 1
          ? t("home.consumptionPeak", { when: bucketTitle(peak.key, shownRange), value: spec.format(peak.total) })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : RANGE_LABEL[range];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("home.consumptionTitle")}</CardTitle>
        <CardDescription title={metric === "cost" ? t("home.costHint") : undefined}>{description}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={metric}
              onValueChange={(v) => {
                if (isUsageMetric(v)) setMetric(v);
              }}
              aria-label={t("home.metricAria")}
            >
              {METRIC_ORDER.map((m) => (
                <ToggleGroupItem key={m} value={m}>
                  {METRICS[m].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={range}
              onValueChange={(v) => {
                if (v === "day" || v === "week" || v === "month") {
                  void useDashboard.getState().setRange(v);
                }
              }}
              aria-label={t("home.rangeAria")}
            >
              <ToggleGroupItem value="day">{t("home.rangeDay")}</ToggleGroupItem>
              <ToggleGroupItem value="week">{t("home.range7d")}</ToggleGroupItem>
              <ToggleGroupItem value="month">{t("home.range30d")}</ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="active:scale-[0.97]"
              aria-pressed={tableMode}
              onClick={() => setTableMode((v) => !v)}
            >
              {tableMode ? <BarChart3 /> : <Table2 />}
              <span>{tableMode ? t("home.viewChart") : t("home.viewTable")}</span>
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[52px] w-2/3 rounded-lg" />
            <Skeleton className="h-[260px] w-full rounded-lg" />
          </div>
        ) : rows.length === 0 || grandTotal === 0 ? (
          <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center animate-in fade-in-0 duration-300">
            <div
              className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden
            >
              <BarChart3 className="size-5" />
            </div>
            <p className="font-medium">
              {metric === "cost" ? t("home.consumptionEmptyCost") : t("home.consumptionEmpty")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("home.consumptionEmptyBody")}
            </p>
          </div>
        ) : (
          <div
            className={cn("flex flex-col gap-4 transition-opacity duration-150", refreshing && "opacity-50")}
            aria-busy={refreshing}
          >
            <div className="px-2 sm:px-0">
              <AgentTotals totals={totals} hidden={hidden} metric={metric} onToggle={toggleAgent} />
            </div>
            <div key={tableMode ? "table" : "chart"} className="animate-in fade-in-0 duration-200">
              {tableMode ? (
                <UsageTable rows={rows} presentAgents={visibleAgents} range={shownRange} metric={metric} />
              ) : (
                <UsageBarChart
                  rows={rows}
                  visibleAgents={visibleAgents}
                  config={config}
                  range={shownRange}
                  metric={metric}
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
