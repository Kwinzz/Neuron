import { type KeyboardEvent, memo } from "react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { Badge } from "@/components/ui/badge";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { StatusDot } from "@/components/ui/StatusDot";
import { TableCell, TableRow } from "@/components/ui/table";
import { t } from "@/i18n";
import { deviceOfThread } from "@/lib/deviceRouting";
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
  const th = live ?? thread;
  const meta = STATUS[th.status];
  const device = deviceOfThread(th.id);

  const openThread = () => {
    useUi.getState().focusThread(th.id);
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
      aria-label={t("home.openChatAria", { title: th.title })}
      onClick={openThread}
      onKeyDown={handleKeyDown}
      className="cursor-pointer duration-150 outline-none focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <TableCell>
        <div className="flex max-w-[280px] items-center gap-1.5">
          <span className="min-w-0 truncate font-medium">{th.title}</span>
          <DeviceBadge device={device} compact />
        </div>
        <div className="max-w-[280px] truncate text-xs text-muted-foreground">
          {th.projectName ?? t("home.noProject")}
        </div>
      </TableCell>
      <TableCell>
        <AgentBadge agent={th.agent} variant="short" />
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          <StatusDot status={th.status} />
          <span className={TONE_TEXT[meta.tone]}>{meta.label}</span>
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatTokens(th.tokens)}
      </TableCell>
      <TableCell className="text-right">
        <RelativeTime ts={th.updatedAt} />
      </TableCell>
    </TableRow>
  );
});
