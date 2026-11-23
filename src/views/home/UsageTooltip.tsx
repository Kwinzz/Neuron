import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageRange } from "@/bindings/UsageRange";
import type { ChartConfig } from "@/components/ui/chart";
import { bucketTitle } from "@/lib/format";
import { METRICS, type UsageMetric } from "./usageMetric";
import type { UsageRow } from "./useUsageChartData";

interface UsageTooltipProps {
  byKey: ReadonlyMap<string, UsageRow>;
  visibleAgents: AgentKind[];
  config: ChartConfig;
  range: UsageRange;
  metric: UsageMetric;
  /* Injected by recharts. */
  active?: boolean;
  label?: string | number;
}

/** Every visible agent of the hovered bucket, value first, plus the bucket total. */
export function UsageTooltip({ byKey, visibleAgents, config, range, metric, active, label }: UsageTooltipProps) {
  const row = label === undefined ? undefined : byKey.get(String(label));
  if (!active || !row) return null;
  const spec = METRICS[metric];
  const agents = visibleAgents.filter((agent) => row[agent] > 0);

  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">{bucketTitle(row.key, range)}</div>
      {agents.length === 0 ? (
        <div className="text-muted-foreground">Aucune activité</div>
      ) : (
        <div className="grid gap-1">
          {agents.map((agent) => (
            <div key={agent} className="flex items-center gap-2">
              <span
                className="h-0.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-${agent})` }}
                aria-hidden
              />
              <span className="font-mono font-medium tabular-nums text-foreground">{spec.format(row[agent])}</span>
              <span className="ml-auto pl-3 text-muted-foreground">{config[agent]?.label ?? agent}</span>
            </div>
          ))}
          {agents.length > 1 && (
            <div className="mt-0.5 flex items-center gap-2 border-t border-border/50 pt-1">
              <span className="w-2.5 shrink-0" aria-hidden />
              <span className="font-mono font-semibold tabular-nums text-foreground">{spec.format(row.total)}</span>
              <span className="ml-auto pl-3 text-muted-foreground">Total</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
