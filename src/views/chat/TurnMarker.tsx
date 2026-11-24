import { memo } from "react";
import { Clock } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { Separator } from "@/components/ui/separator";
import { CostLabel } from "@/components/ui/CostLabel";
import { formatDuration, formatTokens } from "@/lib/format";
import { t } from "@/i18n";

type TurnItem = Extract<ChatItem, { kind: "turn" }>;

/** End of a request: tokens · cost · total time (send → answer). */
export const TurnMarker = memo(function TurnMarker({ item, agent }: { item: TurnItem; agent: AgentKind }) {
  const totalTokens = item.usage.input + item.usage.output;

  return (
    <div className="flex items-center gap-3 py-1">
      <Separator className="flex-1 data-horizontal:w-auto" />
      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground tabular-nums">
        {t("chat.tokens", { n: formatTokens(totalTokens) })} ·{" "}
        <CostLabel agent={agent} costUsd={item.usage.costUsd} tokens={totalTokens} />
        {item.durationMs != null && (
          <>
            <span aria-hidden>·</span>
            <Clock className="size-3" aria-hidden />
            <span title={t("chat.requestTotalTime")}>{formatDuration(item.durationMs)}</span>
          </>
        )}
      </span>
      <Separator className="flex-1 data-horizontal:w-auto" />
    </div>
  );
});
