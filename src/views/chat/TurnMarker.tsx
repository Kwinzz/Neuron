import { memo } from "react";
import type { ChatItem } from "@/bindings/ChatItem";
import { formatCost, formatTokens } from "@/lib/format";

type TurnItem = Extract<ChatItem, { kind: "turn" }>;

export const TurnMarker = memo(function TurnMarker({ item }: { item: TurnItem }) {
  const totalTokens = item.usage.input + item.usage.output;
  const duration =
    item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1).replace(".", ",")} s` : "";

  return (
    <div className="flex items-center gap-3 py-1 text-[11px] text-fg-subtle tabular-nums">
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span>
        {formatTokens(totalTokens)} tokens · {formatCost(item.usage.costUsd)}
        {duration}
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
});
