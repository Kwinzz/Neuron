import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Pencil, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/StatusDot";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENTS } from "@/lib/agents";
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
      <header className="flex flex-col gap-2 pt-4" aria-busy="true">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
        <Separator className="mt-1" />
      </header>
    );
  }

  const activePending = pending && pending.threadId === threadId && pending.title !== live.title ? pending.title : null;
  const displayTitle = activePending ?? live.title;
  const statusMeta = STATUS[live.status];
  const agentMeta = AGENTS[live.agent];
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
    <header className="flex flex-col gap-2 pt-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center">
          {editing ? (
            <Input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              onBlur={() => void commit()}
              aria-label="Nom du thread"
              className="h-8 max-w-[480px] rounded-md bg-transparent px-2 text-base font-semibold md:text-base dark:bg-transparent"
            />
          ) : (
            <button
              type="button"
              title="Renommer"
              onClick={startEdit}
              className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate text-base font-semibold text-foreground">{displayTitle}</span>
              <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="font-mono text-xs text-muted-foreground tabular-nums">
            <span className="font-medium text-foreground">{formatTokens(live.tokens)}</span>{" "}
            tokens ·{" "}
            <span className="font-medium text-foreground">{formatCost(live.costUsd)}</span>
          </div>

          {statusMeta.active && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void useChat.getState().stop(threadId)}
            >
              <Square className="fill-current" />
              Arrêter
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <span className={cn("size-1.5 rounded-full", agentMeta.bg)} aria-hidden />
          {agentMeta.label}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground">
          {live.model ?? "modèle par défaut"}
        </Badge>
        <Badge
          variant="outline"
          className={isBypass ? "border-warn/40 text-warn" : "text-muted-foreground"}
        >
          {permissionLabel}
        </Badge>
        {live.cwd && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="max-w-[320px] truncate rounded-sm font-mono text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {live.cwd}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-md break-all font-mono">
                {live.cwd}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <StatusDot status={live.status} />
          <span className={cn("truncate text-xs font-medium", TONE_TEXT[statusMeta.tone])}>
            {describeStatus(live.status, live.detail)}
          </span>
          {statusMeta.active && (
            <LiveTimer startedAt={live.runStartedAt} className="shrink-0 text-xs text-muted-foreground" />
          )}
        </div>
      </div>

      <Separator className="mt-1" />
    </header>
  );
});
