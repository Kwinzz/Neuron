import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { RANGE_LABEL } from "./rangeLabel";
import { UsageBarChart } from "./UsageBarChart";
import { UsageTable } from "./UsageTable";
import { useUsageChartData } from "./useUsageChartData";

const EMPTY_BUCKETS: never[] = [];

export function ConsumptionCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;
  const [tableMode, setTableMode] = useState(false);

  const { rows, presentAgents, config, grandTotal } = useUsageChartData(
    usage?.buckets ?? EMPTY_BUCKETS,
    range,
  );

  const description = usage
    ? `${formatTokens(usage.totals.input + usage.totals.output)} tokens · ${RANGE_LABEL[range]}`
    : RANGE_LABEL[range];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Consommation</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-2">
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
              aria-label="Période de consommation"
            >
              <ToggleGroupItem value="day">Jour</ToggleGroupItem>
              <ToggleGroupItem value="week">7 jours</ToggleGroupItem>
              <ToggleGroupItem value="month">30 jours</ToggleGroupItem>
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
              <span>{tableMode ? "Graphique" : "Tableau"}</span>
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {isLoading ? (
          <Skeleton className="h-[250px] w-full rounded-lg" />
        ) : rows.length === 0 || grandTotal === 0 ? (
          <div className="flex h-[250px] flex-col items-center justify-center gap-2 text-center animate-in fade-in-0 duration-300">
            <div
              className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden
            >
              <BarChart3 className="size-5" />
            </div>
            <p className="font-medium">Aucune consommation sur cette période</p>
            <p className="text-xs text-muted-foreground">
              En dev, <Kbd>{MOD_LABEL}</Kbd> <Kbd>K</Kbd> → « Générer des données de démo »
            </p>
          </div>
        ) : (
          <div key={tableMode ? "table" : "chart"} className="animate-in fade-in-0 duration-200">
            {tableMode ? (
              <UsageTable rows={rows} presentAgents={presentAgents} range={range} />
            ) : (
              <UsageBarChart
                rows={rows}
                presentAgents={presentAgents}
                config={config}
                range={range}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
