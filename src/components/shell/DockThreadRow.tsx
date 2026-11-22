import { memo } from "react";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusIconBox } from "@/components/ui/StatusIconBox";
import { formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT, describeStatus } from "@/lib/status";
import { type Attention, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const ATTENTION_LABEL: Record<Attention, { text: string; className: string }> = {
  done: { text: "Terminé", className: "bg-ok/15 text-ok" },
  approval: { text: "À valider", className: "bg-warn/15 text-warn" },
  error: { text: "Erreur", className: "bg-danger/15 text-danger" },
};

/** One live thread in the dock. Subscribes to its own slice only. */
export const DockThreadRow = memo(function DockThreadRow({ id }: { id: string }) {
  const thread = useLive((s) => s.threads[id]);
  const attention = useLive((s) => s.attention[id]);
  const focused = useUi((s) => s.focusedThreadId === id);

  if (!thread) return null;
  const meta = STATUS[thread.status];
  const attn = attention ? ATTENTION_LABEL[attention] : null;

  const onClick = () => {
    useUi.getState().focusThread(id);
    useLive.getState().markSeen(id);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={focused ? "true" : undefined}
      className={`flex w-full gap-3 rounded-[15px] p-3 text-left transition-colors duration-fast ${
        focused ? "bg-surface" : "hover:bg-surface/50"
      }`}
    >
      <StatusIconBox status={thread.status} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{thread.title || "Thread sans titre"}</span>
          {attn && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${attn.className}`}>{attn.text}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <AgentBadge agent={thread.agent} variant="short" className="shrink-0" />
          {thread.projectName && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="min-w-0 truncate text-fg-muted">{thread.projectName}</span>
            </>
          )}
        </div>

        <span className={`truncate text-xs font-bold ${TONE_TEXT[meta.tone]}`}>
          {thread.status === "error" && thread.errorMessage
            ? thread.errorMessage
            : describeStatus(thread.status, thread.detail)}
        </span>

        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono tabular-nums text-fg-muted" title="Tokens (entrée + sortie)">
            {formatTokens(thread.tokens)} tok
          </span>
          <LiveTimer
            startedAt={thread.runStartedAt}
            endedAt={meta.active ? null : (thread.endedAt ?? thread.updatedAt)}
            className="text-fg-muted"
          />
        </div>
      </div>
    </button>
  );
});
