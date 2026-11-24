import { useMemo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageBucket } from "@/bindings/UsageBucket";
import type { ChartConfig } from "@/components/ui/chart";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { METRICS, type UsageMetric } from "./usageMetric";

export type UsageRow = {
  key: string;
  /** Sum of the visible agents. */
  total: number;
  /** Visible agent drawn at the top of the stack (rounded end), null when the bucket is empty. */
  top: AgentKind | null;
  /** Visible agent sitting on the baseline (no gap under it). */
  bottom: AgentKind | null;
} & Record<AgentKind, number>;

export interface AgentTotal {
  agent: AgentKind;
  value: number;
  /** Share of all agents (hidden ones included), 0..1. */
  share: number;
}

const AGENT_CHART_CONFIG: ChartConfig = Object.fromEntries(
  AGENT_ORDER.map((agent, i) => [
    agent,
    {
      // Getter: the generic CLI label follows the interface language.
      get label() {
        return AGENTS[agent].label;
      },
      color: `var(--chart-${i + 1})`,
    },
  ]),
);

export function useUsageChartData(
  buckets: readonly UsageBucket[],
  metric: UsageMetric,
  hidden: ReadonlySet<AgentKind>,
) {
  return useMemo(() => {
    const spec = METRICS[metric];
    const agentTotals: Record<AgentKind, number> = {
      claude_code: 0,
      antigravity: 0,
      codex: 0,
      generic: 0,
    };

    const raw = buckets.map((bucket) => {
      const row: UsageRow = {
        key: bucket.key,
        total: 0,
        top: null,
        bottom: null,
        claude_code: 0,
        antigravity: 0,
        codex: 0,
        generic: 0,
      };
      for (const entry of bucket.byAgent) {
        const value = spec.value(entry.sums);
        if (value > 0) {
          row[entry.agent] += value;
          agentTotals[entry.agent] += value;
        }
      }
      return row;
    });

    const presentAgents = AGENT_ORDER.filter((agent) => agentTotals[agent] > 0);
    const visibleAgents = presentAgents.filter((agent) => !hidden.has(agent));
    const grandTotal = presentAgents.reduce((sum, agent) => sum + agentTotals[agent], 0);

    let peak: UsageRow | null = null;
    for (const row of raw) {
      for (const agent of visibleAgents) {
        const value = row[agent];
        if (value <= 0) continue;
        row.total += value;
        row.bottom ??= agent;
        row.top = agent;
      }
      if (row.total > 0 && (peak === null || row.total > peak.total)) peak = row;
    }

    const totals: AgentTotal[] = presentAgents.map((agent) => ({
      agent,
      value: agentTotals[agent],
      share: grandTotal > 0 ? agentTotals[agent] / grandTotal : 0,
    }));

    const visibleTotal = visibleAgents.reduce((sum, agent) => sum + agentTotals[agent], 0);

    return {
      rows: raw,
      presentAgents,
      visibleAgents,
      totals,
      config: AGENT_CHART_CONFIG,
      grandTotal,
      visibleTotal,
      peak,
    };
  }, [buckets, metric, hidden]);
}
