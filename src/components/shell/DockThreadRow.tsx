import { memo } from "react";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT, describeStatus } from "@/lib/status";
import { type Attention, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const ATTENTION_LABEL: Record<Attention, { text: string; className: string; bar: string }> = {
  done: { text: "Terminé", className: "text-ok", bar: "bg-ok" },
  approval: { text: "À valider", className: "text-warn", bar: "bg-warn" },
  error: { text: "Erreur", className: "text-danger", bar: "bg-danger" },
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
      className={`group relative flex w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors duration-fast ${
        focused ? "border-line-strong bg-surface-hover" : "border-transparent hover:bg-surface-hover"
      }`}
    >
      {attn && <span className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${attn.bar}`} aria-hidden />}

      <div className="flex items-center gap-2">
        <StatusDot status={thread.status} />
        <span className="min-w-0 flex-1 truncate text-fg">{thread.title || "Thread sans titre"}</span>
        {attn && <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${attn.className}`}>{attn.text}</span>}
      </div>

      <div className="flex items-center gap-2 pl-4 text-xs">
        <AgentBadge agent={thread.agent} variant="short" className="shrink-0" />
        {thread.projectName && (
          <>
            <span className="text-fg-subtle">·</span>
            <span className="min-w-0 truncate text-fg-subtle">{thread.projectName}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 pl-4 text-xs">
        <span className={`min-w-0 flex-1 truncate ${TONE_TEXT[meta.tone]}`}>
          {thread.status === "error" && thread.errorMessage
            ? thread.errorMessage
            : describeStatus(thread.status, thread.detail)}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-fg-muted" title="Tokens (entrée + sortie)">
          {formatTokens(thread.tokens)}
        </span>
        <LiveTimer
          startedAt={thread.runStartedAt}
          endedAt={meta.active ? null : (thread.endedAt ?? thread.updatedAt)}
          className="w-12 shrink-0 text-right text-fg-subtle"
        />
      </div>
    </button>
  );
});
