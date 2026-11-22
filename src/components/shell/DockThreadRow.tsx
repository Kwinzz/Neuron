import { memo } from "react";
import { cn } from "cn";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { Badge } from "@/components/ui/badge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusDot } from "@/components/ui/StatusDot";
import { useNow } from "@/hooks/useNow";
import { formatRelative, formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT, describeStatus } from "@/lib/status";
import { type Attention, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const ATTENTION_LABEL: Record<Attention, { text: string; className: string }> = {
  done: { text: "Terminé", className: "border-ok/40 text-ok" },
  approval: { text: "À valider", className: "border-warn/40 text-warn" },
  error: { text: "Erreur", className: "border-destructive/40 text-destructive" },
};

/** One live thread in the dock. Subscribes to its own slice only. */
export const DockThreadRow = memo(function DockThreadRow({ id }: { id: string }) {
  const thread = useLive((s) => s.threads[id]);
  const attention = useLive((s) => s.attention[id]);
  const focused = useUi((s) => s.focusedThreadId === id);

  if (!thread) return null;
  const meta = STATUS[thread.status];
  const attn = attention ? ATTENTION_LABEL[attention] : null;

  return (
    <button
      type="button"
      onClick={() => {
        useUi.getState().focusThread(id);
        useLive.getState().markSeen(id);
      }}
      aria-current={focused ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        focused && "border-border bg-sidebar-accent",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={thread.status} />
        <span className="min-w-0 flex-1 truncate font-medium">{thread.title || "Thread sans titre"}</span>
        {attn && (
          <Badge variant="outline" className={cn("shrink-0 px-1.5 text-[10px]", attn.className)}>
            {attn.text}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
        <AgentBadge agent={thread.agent} variant="short" className="shrink-0" />
        {thread.projectName && (
          <>
            <span>·</span>
            <span className="min-w-0 truncate">{thread.projectName}</span>
          </>
        )}
      </div>
      <div className={cn("truncate pl-4 text-xs", TONE_TEXT[meta.tone])}>
        {thread.status === "error" && thread.errorMessage
          ? thread.errorMessage
          : describeStatus(thread.status, thread.detail)}
      </div>
      <div className="flex items-center justify-between pl-4 text-xs text-muted-foreground tabular-nums">
        <span title="Tokens (entrée + sortie)">{formatTokens(thread.tokens)} tokens</span>
        {meta.active ? (
          <LiveTimer startedAt={thread.runStartedAt} className="font-sans" />
        ) : (
          <EndedAgo ts={thread.endedAt ?? thread.updatedAt} />
        )}
      </div>
    </button>
  );
});

function EndedAgo({ ts }: { ts: number }) {
  const now = useNow(30_000);
  return <span>{formatRelative(ts, now)}</span>;
}
