import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { Pencil, Square } from "lucide-react";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { Button } from "@/components/legacy/Button";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusIconBox } from "@/components/ui/StatusIconBox";
import { formatCost, formatTokens } from "@/lib/format";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { describeStatus, STATUS, TONE_TEXT } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { toast } from "@/stores/toast";

const PERMISSION_LABELS: Record<string, string> = {
  manual: "Demande d'approbation",
  acceptEdits: "Éditions auto",
  auto: "Auto",
  plan: "Plan",
  bypassPermissions: "Tout autorisé",
};

/** Thread identity + live status. Subscribes to the live store itself so chat streaming never re-renders it. */
export const ThreadHeader = memo(function ThreadHeader({ threadId }: { threadId: string }) {
  const live = useLive((s) => s.threads[threadId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ threadId: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set once the current edit session is committed or cancelled (blur after Enter/Esc must be a no-op). */
  const settledRef = useRef(false);

  useEffect(() => {
    setEditing(false);
  }, [threadId]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!live) {
    return (
      <header className="glass-card flex items-center gap-4 rounded-xl px-5 py-4" aria-busy="true">
        <div className="size-9 shrink-0 rounded-md bg-surface" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="h-5 w-48 rounded-sm bg-surface" />
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 rounded-sm bg-surface" />
            <div className="h-4 w-32 rounded-sm bg-surface" />
          </div>
          <div className="h-4 w-28 rounded-sm bg-surface" />
        </div>
        <div className="h-4 w-32 shrink-0 rounded-sm bg-surface" />
      </header>
    );
  }

  const activePending = pending && pending.threadId === threadId && pending.title !== live.title ? pending.title : null;
  const displayTitle = activePending ?? live.title;
  const statusMeta = STATUS[live.status];
  const permissionLabel = PERMISSION_LABELS[live.permissionMode] ?? live.permissionMode;
  const isBypass = live.permissionMode === "bypassPermissions";

  const startEdit = () => {
    settledRef.current = false;
    setDraft(displayTitle);
    setEditing(true);
  };

  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === displayTitle) return;

    setPending({ threadId, title: trimmed });
    try {
      await ipc.renameThread(threadId, trimmed);
    } catch (err) {
      setPending((cur) => (cur?.threadId === threadId && cur.title === trimmed ? null : cur));
      toast({
        tone: "danger",
        title: "Renommage impossible",
        description: ipcErrorMessage(err),
      });
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      settledRef.current = true;
      setEditing(false);
    }
  };

  return (
    <header className="glass-card flex flex-wrap items-center gap-4 rounded-xl px-5 py-4">
      <StatusIconBox status={live.status} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              onBlur={() => void commit()}
              aria-label="Nom du thread"
              className="w-full max-w-[480px] rounded-md bg-surface px-2 text-lg font-bold text-fg outline-none"
            />
          ) : (
            <button
              type="button"
              title="Renommer"
              onClick={startEdit}
              className="group flex min-w-0 items-center gap-2 rounded-md text-left transition-colors duration-fast hover:text-fg"
            >
              <span className="truncate text-lg font-bold text-fg">{displayTitle}</span>
              <Pencil
                size={13}
                className="shrink-0 text-fg-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <AgentBadge
            agent={live.agent}
            variant="full"
            className="rounded-sm bg-surface px-2 py-0.5 font-bold"
          />
          <span className="rounded-sm bg-surface px-2 py-0.5 font-bold text-fg-muted">
            {live.model ?? "modèle par défaut"}
          </span>
          <span
            className={`rounded-sm px-2 py-0.5 font-bold ${
              isBypass ? "bg-warn/10 text-warn" : "bg-surface text-fg-muted"
            }`}
          >
            {permissionLabel}
          </span>
          {live.cwd && (
            <span className="max-w-[320px] truncate font-mono text-fg-subtle" title={live.cwd}>
              {live.cwd}
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2 text-sm">
          <span className={`truncate font-bold ${TONE_TEXT[statusMeta.tone]}`}>
            {describeStatus(live.status, live.detail)}
          </span>
          {statusMeta.active && (
            <LiveTimer startedAt={live.runStartedAt} className="shrink-0 text-xs text-fg-muted" />
          )}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="text-right text-sm tabular-nums">
          <span className="font-bold text-fg">{formatTokens(live.tokens)}</span>{" "}
          <span className="text-fg-muted">tokens</span>
          <span className="px-1.5 text-fg-subtle">·</span>
          <span className="font-bold text-fg">{formatCost(live.costUsd)}</span>
        </div>

        {statusMeta.active && (
          <Button
            variant="subtle"
            size="sm"
            className="text-danger"
            onClick={() => void useChat.getState().stop(threadId)}
          >
            <Square size={14} className="fill-current" />
            Arrêter
          </Button>
        )}
      </div>
    </header>
  );
});
