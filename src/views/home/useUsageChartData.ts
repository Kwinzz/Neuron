import { useMemo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageBucket } from "@/bindings/UsageBucket";
import type { UsageRange } from "@/bindings/UsageRange";
import type { ChartConfig } from "@/components/ui/chart";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { bucketLabel } from "@/lib/format";

export type UsageRow = {
  key: string;
  label: string;
  total: number;
} & Record<AgentKind, number>;

const AGENT_CHART_CONFIG: ChartConfig = Object.fromEntries(
  AGENT_ORDER.map((agent, i) => [
    agent,
    {
      label: AGENTS[agent].label,
      color: `var(--chart-${i + 1})`,
    },
  ]),
);

export function useUsageChartData(buckets: readonly UsageBucket[], range: UsageRange) {
  return useMemo(() => {
    const agentTotals: Record<AgentKind, number> = {
      claude_code: 0,
      antigravity: 0,
      codex: 0,
      generic: 0,
    };

    let grandTotal = 0;

    const rows: UsageRow[] = buckets.map((bucket) => {
      const row: UsageRow = {
        key: bucket.key,
        label: bucketLabel(bucket.key, range),
        total: 0,
        claude_code: 0,
        antigravity: 0,
        codex: 0,
        generic: 0,
      };

      for (const entry of bucket.byAgent) {
        const value = entry.sums.input + entry.sums.output;
        if (value > 0) {
          row[entry.agent] += value;
          row.total += value;
          agentTotals[entry.agent] += value;
          grandTotal += value;
        }
      }

      return row;
    });

    const presentAgents = AGENT_ORDER.filter((agent) => agentTotals[agent] > 0);

    return {
      rows,
      presentAgents,
      config: AGENT_CHART_CONFIG,
      grandTotal,
    };
  }, [buckets, range]);
}
