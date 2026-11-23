import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { formatPercent } from "@/lib/format";
import { METRICS, type UsageMetric } from "./usageMetric";
import type { AgentTotal } from "./useUsageChartData";

interface AgentTotalsProps {
  totals: AgentTotal[];
  hidden: ReadonlySet<AgentKind>;
  metric: UsageMetric;
  onToggle: (agent: AgentKind) => void;
}

/** Legend of the chart: one entry per agent with its total and share; a click hides / shows its bars. */
export function AgentTotals({ totals, hidden, metric, onToggle }: AgentTotalsProps) {
  const spec = METRICS[metric];
  const visibleCount = totals.filter((t) => !hidden.has(t.agent)).length;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Agents affichés">
      {totals.map(({ agent, value, share }) => {
        const off = hidden.has(agent);
        const last = !off && visibleCount <= 1;
        return (
          <button
            key={agent}
            type="button"
            aria-pressed={!off}
            disabled={last}
            title={last ? undefined : off ? `Afficher ${AGENTS[agent].label}` : `Masquer ${AGENTS[agent].label}`}
            onClick={() => onToggle(agent)}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-[opacity,background-color] duration-150",
              "hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent",
              off && "opacity-45",
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: `var(--chart-${AGENT_ORDER.indexOf(agent) + 1})` }}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-muted-foreground">{AGENTS[agent].label}</span>
              <span className="flex items-baseline gap-1.5">
                <span className={cn("text-sm font-semibold text-foreground", off && "line-through")}>
                  {spec.format(value)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatPercent(share)}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
