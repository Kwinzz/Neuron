import { Activity, Check, Circle, ShieldAlert, XCircle } from "lucide-react";
import { memo, type ReactNode } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { IconBox } from "@/components/ui/IconBox";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { formatTokens } from "@/lib/format";
import { describeStatus, STATUS, type StatusTone, TONE_TEXT } from "@/lib/status";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

interface TimelineItemProps {
  id: string;
  fallback: ThreadSummary;
  isLast: boolean;
}

const TONE_BOX: Record<StatusTone, "cyan" | "warn" | "ok" | "danger" | "muted"> = {
  live: "cyan",
  pending: "cyan",
  warn: "warn",
  ok: "ok",
  danger: "danger",
  muted: "muted",
};

function toneIcon(tone: StatusTone): ReactNode {
  switch (tone) {
    case "live":
    case "pending":
      return <Activity size={15} />;
    case "warn":
      return <ShieldAlert size={15} />;
    case "ok":
      return <Check size={15} />;
    case "danger":
      return <XCircle size={15} />;
    case "muted":
      return <Circle size={15} />;
  }
}

export const TimelineItem = memo(function TimelineItem({
  id,
  fallback,
  isLast,
}: TimelineItemProps) {
  const live = useLive((s) => s.threads[id]);
  const t = live ?? fallback;
  const meta = STATUS[t.status];
  const tone = meta.tone;

  const handleClick = () => {
    useUi.getState().focusThread(id);
    useUi.getState().setDockOpen(true);
  };

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[15px] top-[34px] w-px bg-line-chart/60"
        />
      )}

      <IconBox size={30} tone={TONE_BOX[tone]}>
        {toneIcon(tone)}
      </IconBox>

      <button
        type="button"
        onClick={handleClick}
        className="-mx-1 min-w-0 flex-1 rounded-md px-1 text-left transition-colors duration-fast hover:bg-surface/50"
      >
        <p className="truncate text-sm font-bold text-fg">{t.title}</p>
        <p className={`mt-0.5 truncate text-xs ${TONE_TEXT[tone]}`}>
          {describeStatus(t.status, live?.detail)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <LiveTimer
            startedAt={live?.runStartedAt ?? t.updatedAt}
            endedAt={meta.active ? null : (t.endedAt ?? t.updatedAt)}
          />
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatTokens(t.tokens)} tokens</span>
          <span aria-hidden>·</span>
          <AgentBadge agent={t.agent} variant="short" />
        </div>
      </button>
    </li>
  );
});
