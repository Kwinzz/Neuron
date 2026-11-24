import { type KeyboardEvent, memo } from "react";
import { Layers } from "lucide-react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/StatusDot";
import { TableCell, TableRow } from "@/components/ui/table";
import { t } from "@/i18n";
import { STATUS, TONE_TEXT } from "@/lib/status";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { RelativeTime } from "./RelativeTime";

interface ProjectChatRowProps {
  thread: ThreadSummary;
}

export const ProjectChatRow = memo(function ProjectChatRow({ thread }: ProjectChatRowProps) {
  const live = useLive((s) => s.threads[thread.id]);
  const th = live ?? thread;
  const meta = STATUS[th.status];

  const openChat = () => {
    useUi.getState().focusThread(th.id);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openChat();
    }
  };

  return (
    <TableRow
      tabIndex={0}
      aria-label={t("project.openChatAria", { title: th.title || t("common.untitledChat") })}
      onClick={openChat}
      onKeyDown={handleKeyDown}
      className="cursor-pointer transition-colors duration-150 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {/* w-full + max-w-0: the title column absorbs the free width and truncates instead of overflowing. */}
      <TableCell className="w-full max-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-foreground" title={th.title}>
            {th.title || t("common.untitledChat")}
          </span>
          {thread.hasContext && (
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("project.ctxTitle")} />
          )}
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
      <TableCell className="text-right">
        <RelativeTime ts={th.updatedAt} className="text-xs text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
});
