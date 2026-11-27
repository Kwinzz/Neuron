import { cn } from "cn";
import { memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusIconBox } from "@/components/ui/StatusIconBox";
import { t as tr } from "@/i18n";
import { deviceOfThread } from "@/lib/deviceRouting";
import { formatTokens } from "@/lib/format";
import { describeStatus, STATUS, TONE_TEXT } from "@/lib/status";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

interface ActiveThreadRowProps {
  id: string;
  fallback: ThreadSummary;
}

export const ActiveThreadRow = memo(function ActiveThreadRow({
  id,
  fallback,
}: ActiveThreadRowProps) {
  const live = useLive((s) => s.threads[id]);
  const t = live ?? fallback;
  const meta = STATUS[t.status];
  const device = deviceOfThread(id);

  const handleClick = () => {
    useUi.getState().focusThread(id);
    useUi.getState().setDockOpen(true);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-[background-color,transform] duration-fast hover:bg-muted/50 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
    >
      <StatusIconBox status={t.status} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate font-medium">{t.title || tr("common.untitledChat")}</p>
          <DeviceBadge device={device} compact />
        </div>
        <p className={cn("truncate text-xs", TONE_TEXT[meta.tone])}>
          {describeStatus(t.status, live?.detail)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <LiveTimer
            startedAt={live?.runStartedAt ?? t.updatedAt}
            endedAt={meta.active ? null : (t.endedAt ?? t.updatedAt)}
          />
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums">{formatTokens(t.tokens)} tokens</span>
          <span aria-hidden>·</span>
          <AgentBadge agent={t.agent} variant="short" />
        </div>
      </div>
    </button>
  );
});
