import { memo } from "react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Separator } from "@/components/ui/separator";
import { formatCost, formatTokens } from "@/lib/format";

type TurnItem = Extract<ChatItem, { kind: "turn" }>;

export const TurnMarker = memo(function TurnMarker({ item }: { item: TurnItem }) {
  const totalTokens = item.usage.input + item.usage.output;
  const duration =
    item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1).replace(".", ",")} s` : "";

  return (
    <div className="flex items-center gap-3 py-1">
      <Separator className="flex-1 data-horizontal:w-auto" />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {formatTokens(totalTokens)} tokens · {formatCost(item.usage.costUsd)}
        {duration}
      </span>
      <Separator className="flex-1 data-horizontal:w-auto" />
    </div>
  );
});
