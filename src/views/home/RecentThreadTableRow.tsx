import { type KeyboardEvent, memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT } from "@/lib/status";
import { useUi } from "@/stores/ui";
import { RelativeTime } from "./RelativeTime";

interface RecentThreadTableRowProps {
  thread: ThreadSummary;
}

export const RecentThreadTableRow = memo(function RecentThreadTableRow({
  thread,
}: RecentThreadTableRowProps) {
  const meta = STATUS[thread.status];

  const openThread = () => {
    useUi.getState().focusThread(thread.id);
    useUi.getState().setDockOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openThread();
    }
  };

  return (
    <tr
      tabIndex={0}
      aria-label={`Ouvrir ${thread.title}`}
      onClick={openThread}
      onKeyDown={handleKeyDown}
      className="cursor-pointer border-b border-line-chart/60 transition-colors duration-fast last:border-b-0 hover:bg-surface/50"
    >
      <td className="py-3 pr-3">
        <p className="max-w-[280px] truncate text-sm font-bold text-fg">{thread.title}</p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          {thread.projectName ?? "Sans projet"}
        </p>
      </td>
      <td className="px-3 py-3">
        <AgentBadge agent={thread.agent} variant="short" className="text-sm" />
      </td>
      <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-fg">
        {formatTokens(thread.tokens)}
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-2">
          <StatusDot status={thread.status} />
          <span className={`text-sm font-bold ${TONE_TEXT[meta.tone]}`}>{meta.label}</span>
        </span>
      </td>
      <td className="py-3 pl-3 text-right">
        <RelativeTime ts={thread.updatedAt} />
      </td>
    </tr>
  );
});
