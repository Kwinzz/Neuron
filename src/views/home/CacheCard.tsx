import { IS_LINUX } from "@/lib/platform";
import { useMemo } from "react";
import { Label, PolarAngleAxis, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { formatPercent, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { RANGE_LABEL } from "./rangeLabel";

const CACHE_CHART_CONFIG: ChartConfig = {
  cache: {
    get label() {
      return t("home.cacheReadLabel");
    },
    color: "var(--primary)",
  },
};

export function CacheCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const cacheRead = usage?.totals.cacheRead ?? 0;
  const cacheWrite = usage?.totals.cacheWrite ?? 0;
  const input = usage?.totals.input ?? 0;
  const denom = cacheRead + input;
  const ratio = denom > 0 ? cacheRead / denom : null;
  const pct = ratio != null ? Math.round(ratio * 100) : 0;
  const pctText = ratio != null ? formatPercent(ratio) : "—";

  const chartData = useMemo(
    () => [{ name: "cache", value: pct, fill: "var(--color-cache)" }],
    [pct],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home.cacheTitle")}</CardTitle>
        <CardDescription>{RANGE_LABEL[range]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {isLoading ? (
          <>
            <Skeleton className="mx-auto aspect-square w-full max-w-[280px] rounded-full" />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          </>
        ) : (
          <>
            <div
              role="img"
              aria-label={
                ratio != null ? t("home.cacheRateAria", { pct: pctText }) : t("home.cacheNoData")
              }
              // The ring fills the free height of the card (it stretches next to taller cards) and scales with it.
              className="flex flex-1 items-center justify-center animate-in fade-in-0 duration-300"
            >
              <ChartContainer
                config={CACHE_CHART_CONFIG}
                className="aspect-square w-full max-w-[280px] min-w-[150px]"
              >
                <RadialBarChart
                  data={chartData}
                  startAngle={90}
                  endAngle={-270}
                  innerRadius="76%"
                  outerRadius="98%"
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
                  <RadialBar
                    dataKey="value"
                    background
                    cornerRadius={10}
                    isAnimationActive={!IS_LINUX}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                  <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          const cx = viewBox.cx ?? 0;
                          const cy = viewBox.cy ?? 0;
                          return (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan
                                x={cx}
                                y={cy}
                                className="fill-foreground text-3xl font-bold tabular-nums"
                              >
                                {pctText}
                              </tspan>
                              <tspan x={cx} y={cy + 24} className="fill-muted-foreground text-xs">
                                {t("home.cacheReadCaption")}
                              </tspan>
                            </text>
                          );
                        }
                        return null;
                      }}
                    />
                  </PolarRadiusAxis>
                </RadialBarChart>
              </ChartContainer>
            </div>

            <div className="flex flex-col gap-3 animate-in fade-in-0 duration-300">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("home.cacheRead")}</span>
                <span className="font-mono font-medium tabular-nums">
                  {usage ? formatTokens(cacheRead) : "—"}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("home.cacheWritten")}</span>
                <span className="font-mono font-medium tabular-nums">
                  {usage ? formatTokens(cacheWrite) : "—"}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
