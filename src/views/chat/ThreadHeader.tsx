import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { FolderOpen, Pencil, Square } from "lucide-react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/StatusDot";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENTS, COST_NOT_REPORTED, reportsCost } from "@/lib/agents";
import { formatCost, formatTokens } from "@/lib/format";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { describeStatus, STATUS, TONE_TEXT } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { effortLabel } from "@/lib/models";
import { findModel, useModels } from "@/stores/models";
import { toast } from "@/stores/toast";

/** Sticky bar: full-bleed inside the scroll container, content aligned with the timeline. */
const BAR =
  "sticky top-0 z-20 -mx-4 border-b bg-background/75 px-4 backdrop-blur-xl md:-mx-6 md:px-6";

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

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
      <header className={BAR} aria-busy="true">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 py-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
      </header>
    );
  }

  const activePending = pending && pending.threadId === threadId && pending.title !== live.title ? pending.title : null;
  const displayTitle = activePending ?? live.title;
  const statusMeta = STATUS[live.status];
  const agentMeta = AGENTS[live.agent];

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
    <header className={BAR}>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 py-3">
        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card shadow-xs">
          <AgentLogo agent={live.agent} size={18} />
          {statusMeta.active && (
            <span className="absolute -right-0.5 -top-0.5 flex size-2.5 animate-in fade-in-0 zoom-in-50 duration-200" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-live/70" />
              <span className="relative size-2.5 rounded-full bg-live ring-2 ring-background" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {editing ? (
            <Input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              onBlur={() => void commit()}
              aria-label="Nom du chat"
              className="h-7 max-w-[480px] rounded-md bg-transparent px-1.5 text-sm font-semibold md:text-sm dark:bg-transparent"
            />
          ) : (
            <button
              type="button"
              title="Renommer"
              onClick={startEdit}
              className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate text-sm font-semibold text-foreground">{displayTitle || "Chat sans titre"}</span>
              <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          )}
          <HeaderMeta agentLabel={agentMeta.label} agent={live.agent} model={live.model} effort={live.effort} cwd={live.cwd} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant="outline"
            className={cn("hidden max-w-60 gap-1.5 bg-card sm:inline-flex", TONE_TEXT[statusMeta.tone])}
          >
            <StatusDot status={live.status} />
            <span className="truncate">{describeStatus(live.status, live.detail)}</span>
            {statusMeta.active && <LiveTimer startedAt={live.runStartedAt} className="font-sans text-muted-foreground" />}
          </Badge>
          <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline">
            {formatTokens(live.tokens)} tokens ·{" "}
            {reportsCost(live.agent) ? (
              formatCost(live.costUsd)
            ) : (
              <span title={COST_NOT_REPORTED}>inclus (abonnement)</span>
            )}
          </span>
          {statusMeta.active && (
            <Button
              variant="outline"
              size="sm"
              className="animate-in fade-in-0 zoom-in-95 duration-150 active:scale-[0.97]"
              onClick={() => void useChat.getState().stop(threadId)}
            >
              <Square className="fill-current" />
              Arrêter
            </Button>
          )}
        </div>
      </div>
    </header>
  );
});

/** "Claude Code · Claude Opus 5.5 · Élevé · 📁 neuron" */
const HeaderMeta = memo(function HeaderMeta({
  agentLabel,
  agent,
  model,
  effort,
  cwd,
}: {
  agentLabel: string;
  agent: Parameters<typeof findModel>[1];
  model: string | null;
  effort: string | null;
  cwd: string | null;
}) {
  const modelInfo = useModels((s) => findModel(s.providers, agent, model));
  // Antigravity families: the level is the selected variant's.
  const level =
    (modelInfo?.effortModels ? Object.entries(modelInfo.effortModels).find(([, id]) => id === model)?.[0] : undefined) ??
    effort;
  const parts = [agentLabel, modelInfo?.label ?? model ?? "modèle par défaut", level ? `raisonnement ${effortLabel(level).toLowerCase()}` : null].filter(
    (p): p is string => Boolean(p),
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate">{parts.join(" · ")}</span>
      {cwd && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex min-w-0 shrink items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span aria-hidden>·</span>
                <FolderOpen className="size-3 shrink-0" />
                <span className="truncate font-mono">{folderName(cwd)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md break-all font-mono">{cwd}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});
