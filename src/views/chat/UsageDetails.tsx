import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import type { LiveWindow } from "@/bindings/LiveWindow";
import { CostLabel } from "@/components/ui/CostLabel";
import { Separator } from "@/components/ui/separator";
import { useNow } from "@/hooks/useNow";
import { t } from "@/i18n";
import { AGENTS } from "@/lib/agents";
import { formatCountdown, formatPercent, formatRelative, formatTokens } from "@/lib/format";
import { quotaLabel, quotaTone } from "./chatQuotas";

interface UsageDetailsProps {
  agent: AgentKind;
  tokens: number;
  costUsd: number;
  windows: LiveWindow[];
  reportedAt: number;
}

/** Content of the header's consumption popover: this chat's tokens and cost, then the subscription quotas. */
export function UsageDetails({ agent, tokens, costUsd, windows, reportedAt }: UsageDetailsProps) {
  const now = useNow(60_000);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <section className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("chat.usageThisChat")}</p>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("chat.usageTokens")}</span>
          <span className="font-mono tabular-nums">{formatTokens(tokens)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("chat.usageCost")}</span>
          <span className="font-mono tabular-nums">
            <CostLabel agent={agent} costUsd={costUsd} tokens={tokens} />
          </span>
        </div>
      </section>

      {windows.length > 0 && (
        <>
          <Separator />
          <section className="flex flex-col gap-2.5" aria-label={t("chat.subscriptionQuotas")}>
            <p className="text-xs font-medium text-muted-foreground">
              {t("chat.usageSubscription", { agent: AGENTS[agent].label })}
              {windows[0]?.group ? ` · ${windows[0].group}` : ""}
            </p>
            {windows.map((w) => (
              <div key={w.window} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>{quotaLabel(w.window)}</span>
                  <span className="font-mono tabular-nums">{formatPercent(w.utilization)}</span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn("absolute inset-y-0 left-0 rounded-full", quotaTone(w.utilization))}
                    style={{ width: `${Math.min(100, w.utilization * 100)}%` }}
                  />
                </div>
                {w.resetsAt != null && w.resetsAt > now && (
                  <span className="text-xs text-muted-foreground">
                    {t("chat.usageResetIn", { time: formatCountdown(w.resetsAt - now) })}
                  </span>
                )}
              </div>
            ))}
            {reportedAt > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("chat.usageUpdated", { time: formatRelative(reportedAt, now) })}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
