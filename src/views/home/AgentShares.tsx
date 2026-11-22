import { useMemo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { AgentUsage } from "@/bindings/AgentUsage";
import { AGENT_ORDER } from "@/lib/agents";
import { AgentShare } from "./AgentShare";
import { Placeholder } from "./Placeholder";

interface AgentSharesProps {
  byAgent: AgentUsage[];
  loading?: boolean;
}

export function AgentShares({ byAgent, loading = false }: AgentSharesProps) {
  const items = useMemo(() => {
    const tokensByAgent: Partial<Record<AgentKind, number>> = {};
    let total = 0;
    for (const entry of byAgent) {
      const tokens = entry.sums.input + entry.sums.output;
      if (tokens > 0) {
        tokensByAgent[entry.agent] = (tokensByAgent[entry.agent] ?? 0) + tokens;
        total += tokens;
      }
    }
    return AGENT_ORDER.flatMap((agent) => {
      const tokens = tokensByAgent[agent] ?? 0;
      if (tokens <= 0) return [];
      return [{ agent, tokens, share: total > 0 ? tokens / total : 0 }];
    });
  }, [byAgent]);

  return (
    <div className="@container">
      <div className="mb-4 mt-6 flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">Par IA</h3>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-[18px] @xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Placeholder className="h-[30px] w-24" />
              <Placeholder className="h-5 w-16" />
              <Placeholder className="h-[5px] w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucune donnée par IA</p>
      ) : (
        <div className="grid grid-cols-2 gap-[18px] @xl:grid-cols-4">
          {items.map((item) => (
            <AgentShare
              key={item.agent}
              agent={item.agent}
              tokens={item.tokens}
              share={item.share}
            />
          ))}
        </div>
      )}
    </div>
  );
}
