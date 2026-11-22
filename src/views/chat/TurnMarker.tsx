import { memo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { Separator } from "@/components/ui/separator";
import { COST_NOT_REPORTED, reportsCost } from "@/lib/agents";
import { formatCost, formatTokens } from "@/lib/format";

type TurnItem = Extract<ChatItem, { kind: "turn" }>;

export const TurnMarker = memo(function TurnMarker({ item, agent }: { item: TurnItem; agent: AgentKind }) {
  const totalTokens = item.usage.input + item.usage.output;
  const duration =
    item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1).replace(".", ",")} s` : "";

  return (
    <div className="flex items-center gap-3 py-1">
      <Separator className="flex-1 data-horizontal:w-auto" />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {formatTokens(totalTokens)} tokens ·{" "}
        {reportsCost(agent) ? (
          formatCost(item.usage.costUsd)
        ) : (
          <span title={COST_NOT_REPORTED}>inclus (abonnement)</span>
        )}
        {duration}
      </span>
      <Separator className="flex-1 data-horizontal:w-auto" />
    </div>
  );
});
