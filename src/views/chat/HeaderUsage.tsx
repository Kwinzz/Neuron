import { cn } from "cn";
import { Gauge } from "lucide-react";
import { memo, useState } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { Button } from "@/components/ui/button";
import { CostLabel } from "@/components/ui/CostLabel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { formatPercent } from "@/lib/format";
import { useChatQuotas } from "./chatQuotas";
import { UsageDetails } from "./UsageDetails";

/** From this utilization on, the most used quota shows on the button itself. */
const HOT = 0.7;

interface HeaderUsageProps {
  agent: AgentKind;
  model: string | null;
  tokens: number;
  costUsd: number;
}

/**
 * One compact button for the chat's consumption: its cost (plus the most used quota when it runs high); tokens,
 * cost and the subscription quotas in a popover.
 */
export const HeaderUsage = memo(function HeaderUsage({ agent, model, tokens, costUsd }: HeaderUsageProps) {
  const [open, setOpen] = useState(false);
  const { windows, reportedAt } = useChatQuotas(agent, model);
  const hottest = windows.reduce<number | null>((max, w) => (max === null || w.utilization > max ? w.utilization : max), null);
  const hot = hottest !== null && hottest >= HOT;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 font-normal text-muted-foreground tabular-nums"
          aria-label={t("chat.usageButton")}
        >
          <Gauge aria-hidden />
          <CostLabel agent={agent} costUsd={costUsd} tokens={tokens} />
          {hot && (
            <span className={cn("font-mono text-xs", hottest >= 0.9 ? "text-destructive" : "text-warn")}>
              {formatPercent(hottest)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {open && (
          <UsageDetails agent={agent} tokens={tokens} costUsd={costUsd} windows={windows} reportedAt={reportedAt} />
        )}
      </PopoverContent>
    </Popover>
  );
});
