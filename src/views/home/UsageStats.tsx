import type { UsageSums } from "@/bindings/UsageSums";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";

interface UsageStatsProps {
  totals: UsageSums;
}

export function UsageStats({ totals }: UsageStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      <div className="flex flex-col justify-between gap-1 bg-surface p-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          Tokens entrée
        </span>
        <span className="font-mono text-lg tabular-nums text-fg">{formatTokens(totals.input)}</span>
      </div>

      <div className="flex flex-col justify-between gap-1 bg-surface p-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          Tokens sortie
        </span>
        <span className="font-mono text-lg tabular-nums text-fg">
          {formatTokens(totals.output)}
        </span>
      </div>

      <div className="flex flex-col justify-between gap-1 bg-surface p-3">
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Cache lu
          </span>
          <span className="truncate font-mono text-[10px] tabular-nums text-fg-subtle" title="Tokens écrits en cache">
            écrit {formatTokens(totals.cacheWrite)}
          </span>
        </div>
        <span className="font-mono text-lg tabular-nums text-fg">{formatTokens(totals.cacheRead)}</span>
      </div>

      <div className="flex flex-col justify-between gap-1 bg-surface p-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          Coût estimé
        </span>
        <span className="font-mono text-lg tabular-nums text-fg">
          {formatCost(totals.costUsd)}
        </span>
      </div>

      <div className="col-span-2 flex flex-col justify-between gap-1 bg-surface p-3 sm:col-span-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          Tours
        </span>
        <span className="font-mono text-lg tabular-nums text-fg">
          {formatInteger(totals.turns)}
        </span>
      </div>
    </div>
  );
}
