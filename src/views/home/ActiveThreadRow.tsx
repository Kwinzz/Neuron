import { memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusDot } from "@/components/ui/StatusDot";
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
  const tone = meta.tone;

  const handleClick = () => {
    useUi.getState().focusThread(id);
    useUi.getState().setDockOpen(true);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={t.status} />
          <span className="truncate text-xs text-fg">{t.title}</span>
        </div>
        <LiveTimer
          startedAt={live?.runStartedAt ?? t.updatedAt}
          endedAt={meta.active ? null : (t.endedAt ?? t.updatedAt)}
          className="shrink-0 text-[11px] text-fg-muted"
        />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 pl-4 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate ${TONE_TEXT[tone]}`}>
            {describeStatus(t.status, live?.detail)}
          </span>
          <span className="text-fg-subtle" aria-hidden>
            ·
          </span>
          <AgentBadge agent={t.agent} variant="short" className="shrink-0" />
          {t.projectName && (
            <>
              <span className="text-fg-subtle" aria-hidden>
                ·
              </span>
              <span className="truncate text-fg-subtle">{t.projectName}</span>
            </>
          )}
        </div>
        <span className="shrink-0 font-mono tabular-nums text-fg-subtle">
          {formatTokens(t.tokens)} tok
        </span>
      </div>
    </button>
  );
});
