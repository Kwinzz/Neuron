import { memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { useNow } from "@/hooks/useNow";
import { formatRelative } from "@/lib/format";
import { STATUS, TONE_TEXT } from "@/lib/status";
import { useUi } from "@/stores/ui";

interface RecentThreadRowProps {
  thread: ThreadSummary;
}

export const RecentThreadRow = memo(function RecentThreadRow({ thread }: RecentThreadRowProps) {
  const now = useNow(60_000);
  const statusMeta = STATUS[thread.status];

  const handleClick = () => {
    useUi.getState().focusThread(thread.id);
    useUi.getState().setDockOpen(true);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-fg">{thread.title}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
          {formatRelative(thread.updatedAt, now)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        <AgentBadge agent={thread.agent} variant="short" className="shrink-0" />
        <span className="text-fg-subtle" aria-hidden>
          ·
        </span>
        <span className="truncate text-fg-subtle">{thread.projectName ?? "Sans projet"}</span>
        <span className="text-fg-subtle" aria-hidden>
          ·
        </span>
        <span className={`shrink-0 ${TONE_TEXT[statusMeta.tone]}`}>{statusMeta.label}</span>
      </div>
    </button>
  );
});
