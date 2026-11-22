import { type KeyboardEvent, memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/StatusDot";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT } from "@/lib/status";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { RelativeTime } from "./RelativeTime";

interface RecentThreadRowProps {
  thread: ThreadSummary;
}

export const RecentThreadRow = memo(function RecentThreadRow({ thread }: RecentThreadRowProps) {
  const live = useLive((s) => s.threads[thread.id]);
  const t = live ?? thread;
  const meta = STATUS[t.status];

  const openThread = () => {
    useUi.getState().focusThread(t.id);
    useUi.getState().setDockOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openThread();
    }
  };

  return (
    <TableRow
      tabIndex={0}
      aria-label={`Ouvrir ${t.title}`}
      onClick={openThread}
      onKeyDown={handleKeyDown}
      className="cursor-pointer duration-150 outline-none focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <TableCell>
        <div className="max-w-[280px] truncate font-medium">{t.title}</div>
        <div className="max-w-[280px] truncate text-xs text-muted-foreground">
          {t.projectName ?? "Sans projet"}
        </div>
      </TableCell>
      <TableCell>
        <AgentBadge agent={t.agent} variant="short" />
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          <StatusDot status={t.status} />
          <span className={TONE_TEXT[meta.tone]}>{meta.label}</span>
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatTokens(t.tokens)}
      </TableCell>
      <TableCell className="text-right">
        <RelativeTime ts={t.updatedAt} />
      </TableCell>
    </TableRow>
  );
});
