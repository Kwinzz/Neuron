import type { AgentKind } from "@/bindings/AgentKind";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { formatTokens } from "@/lib/format";

interface ChartTooltipProps {
  title: string;
  valuesByAgent: Partial<Record<AgentKind, number>>;
  total: number;
  left: number;
  width: number;
}

export function ChartTooltip({ title, valuesByAgent, total, left, width }: ChartTooltipProps) {
  return (
    <div
      style={{ left: `${left}px`, top: "4px", width: `${width}px` }}
      className="glass-overlay pointer-events-none absolute z-10 px-3 py-2.5 text-xs shadow-lg"
    >
      <div className="mb-1.5 font-bold text-fg">{title}</div>
      <div className="flex flex-col gap-1">
        {AGENT_ORDER.map((agent) => {
          const val = valuesByAgent[agent] ?? 0;
          if (val <= 0) return null;
          return (
            <div key={agent} className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-fg-muted">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: AGENTS[agent].color }}
                  aria-hidden
                />
                <span>{AGENTS[agent].label}</span>
              </span>
              <span className="font-bold tabular-nums text-fg">{formatTokens(val)}</span>
            </div>
          );
        })}
      </div>
      <div className="my-1.5 border-t border-line" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-muted">Total</span>
        <span className="font-bold tabular-nums text-fg">{formatTokens(total)}</span>
      </div>
    </div>
  );
}
