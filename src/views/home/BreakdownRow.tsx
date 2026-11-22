import { memo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { AGENTS } from "@/lib/agents";
import { formatCost, formatTokens } from "@/lib/format";

interface BreakdownRowProps {
  agent?: AgentKind;
  label?: string;
  tokens: number;
  costUsd: number;
  ratio: number;
}

export const BreakdownRow = memo(function BreakdownRow({
  agent,
  label,
  tokens,
  costUsd,
  ratio,
}: BreakdownRowProps) {
  const fillClass = agent ? AGENTS[agent].bg : "bg-accent/60";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
      <div className="min-w-0 truncate text-xs text-fg">
        {agent ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className={`size-1.5 shrink-0 rounded-[2px] ${AGENTS[agent].bg}`} aria-hidden />
            <span className="truncate">{AGENTS[agent].label}</span>
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </div>

      <span className="text-right font-mono text-xs tabular-nums text-fg">
        {formatTokens(tokens)}
      </span>

      <span className="min-w-[60px] text-right font-mono text-xs tabular-nums text-fg-subtle">
        {formatCost(costUsd)}
      </span>

      <div className="col-span-3 mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-surface-hover">
        <div
          className={`h-full w-full origin-left rounded-full ${fillClass} transition-transform duration-fast`}
          style={{ transform: `scaleX(${Math.min(Math.max(ratio, 0), 1)})` }}
        />
      </div>
    </div>
  );
});
