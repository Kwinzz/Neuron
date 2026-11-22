import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageRange } from "@/bindings/UsageRange";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { bucketLabel, bucketTitle, formatTokens } from "@/lib/format";
import type { UsageRow } from "./useUsageChartData";

interface UsageBarChartProps {
  rows: UsageRow[];
  presentAgents: AgentKind[];
  config: ChartConfig;
  range: UsageRange;
}

function toNumber(value: number | string | ReadonlyArray<number | string> | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(value) && value.length > 0) {
    const parsed = Number(value[0]);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function UsageBarChart({ rows, presentAgents, config, range }: UsageBarChartProps) {
  return (
    <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
      <BarChart data={rows} accessibilityLayer margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(k: string) => bucketLabel(k, range)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => formatTokens(v)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) => bucketTitle(String(value), range)}
              formatter={(value, name) => {
                const key = String(name ?? "");
                const numeric = toNumber(value);
                return (
                  <div className="flex w-full items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: `var(--color-${key})` }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">{config[key]?.label ?? key}</span>
                    <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                      {formatTokens(numeric)}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        {presentAgents.map((agent, i) => (
          <Bar
            key={agent}
            dataKey={agent}
            stackId="a"
            fill={`var(--color-${agent})`}
            radius={i === presentAgents.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}
