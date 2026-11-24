import { IS_LINUX } from "@/lib/platform";
import { useMemo } from "react";
import { Bar, BarChart, type BarShapeProps, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageRange } from "@/bindings/UsageRange";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { bucketLabel } from "@/lib/format";
import { UsageTooltip } from "./UsageTooltip";
import { METRICS, type UsageMetric } from "./usageMetric";
import type { UsageRow } from "./useUsageChartData";

interface UsageBarChartProps {
  rows: UsageRow[];
  visibleAgents: AgentKind[];
  config: ChartConfig;
  range: UsageRange;
  metric: UsageMetric;
}

/** Surface gap between stacked segments (px). */
const GAP = 2;
/** Rounded data end (px). */
const RADIUS = 4;
/** Bars never fill their slot. */
const MAX_BAR = 24;

/** One stacked segment: rounded only at the top of its stack, a surface gap under it unless it sits on the baseline. */
function segmentPath(x: number, y: number, w: number, h: number, rounded: boolean): string {
  if (!rounded) return `M${x},${y}h${w}v${h}h${-w}Z`;
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

export function UsageBarChart({ rows, visibleAgents, config, range, metric }: UsageBarChartProps) {
  const spec = METRICS[metric];
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  const shapeFor = (agent: AgentKind) =>
    function Segment(props: BarShapeProps) {
      const row = rows[props.index];
      if (!row || props.height <= 0 || props.width <= 0) return <g />;
      const gap = row.bottom === agent ? 0 : GAP;
      // A tiny value keeps a visible sliver instead of disappearing into the gap.
      const h = Math.max(1, props.height - gap);
      return (
        <path
          d={segmentPath(props.x, props.y, props.width, h, row.top === agent)}
          fill={`var(--color-${agent})`}
        />
      );
    };

  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <BarChart data={rows} accessibilityLayer margin={{ top: 8, left: 0, right: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={range === "month" ? 16 : 24}
          tickFormatter={(k: string) => bucketLabel(k, range)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={metric === "cost" ? 52 : 44}
          allowDecimals={!spec.integer}
          tickFormatter={(v: number) => spec.axis(v)}
        />
        <ChartTooltip
          // No position tween: the details appear where the pointer is instead of sliding across the page.
          isAnimationActive={false}
          cursor={{ fill: "var(--muted)", opacity: 0.5, radius: 6 }}
          content={<UsageTooltip byKey={byKey} visibleAgents={visibleAgents} config={config} range={range} metric={metric} />}
        />
        {visibleAgents.map((agent) => (
          <Bar
            key={agent}
            dataKey={agent}
            stackId="usage"
            fill={`var(--color-${agent})`}
            maxBarSize={MAX_BAR}
            shape={shapeFor(agent)}
            // Linux (WebKitGTK): no tween, each frame redraws the whole SVG chart.
            isAnimationActive={!IS_LINUX}
            animationDuration={350}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
