import { IS_LINUX } from "@/lib/platform";
import { type KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { ContextIndicator } from "@/components/context/ContextIndicator";
import {
  Folder,
  FolderInput,
  FolderKanban,
  FolderMinus,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Square,
  Trash2,
} from "lucide-react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { AGENTS } from "@/lib/agents";
import { RENAME_CHAT_EVENT, moveChatToProject, renameChat } from "@/lib/chatActions";
import { deviceOfProject, deviceOfThread } from "@/lib/deviceRouting";
import { HeaderUsage } from "./HeaderUsage";
import { openFolder } from "@/lib/openFolder";
import { describeStatus, STATUS, TONE_TEXT } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useChatDeletion } from "@/stores/chatDeletion";
import { useLive } from "@/stores/live";
import { effortLabel } from "@/lib/models";
import { findModel, useDeviceProviders } from "@/stores/models";
import { useNav } from "@/stores/nav";
import { useUi } from "@/stores/ui";
import { t } from "@/i18n";

/** Sticky bar: full-bleed inside the scroll container, content aligned with the timeline. */
const BAR = `sticky top-0 z-20 -mx-4 border-b px-4 md:-mx-6 md:px-6 ${
  // WebKitGTK repaints the blur at every scroll frame: opaque bar on Linux.
  IS_LINUX ? "bg-background" : "bg-background/75 backdrop-blur-xl"
}`;

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Thread identity + live status. Subscribes to the live store itself so chat streaming never re-renders it. */
export const ThreadHeader = memo(function ThreadHeader({ threadId }: { threadId: string }) {
  const live = useLive((s) => s.threads[threadId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set once the current edit session is committed or cancelled (blur after Enter/Esc must be a no-op). */
  const settledRef = useRef(false);
  const titleRef = useRef(live?.title ?? "");
  titleRef.current = live?.title ?? "";
  const hasLiveRef = useRef(Boolean(live));
  hasLiveRef.current = Boolean(live);

  useEffect(() => {
    setEditing(false);
  }, [threadId]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (!hasLiveRef.current) return;
      if ((e as CustomEvent<string>).detail !== threadId) return;
      settledRef.current = false;
      setDraft(titleRef.current);
      setEditing(true);
    };
    window.addEventListener(RENAME_CHAT_EVENT, handler);
    return () => window.removeEventListener(RENAME_CHAT_EVENT, handler);
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

  const displayTitle = live.title;
  const statusMeta = STATUS[live.status];
  const agentMeta = AGENTS[live.agent];
  const device = deviceOfThread(threadId);

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
    await renameChat(threadId, trimmed);
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
              aria-label={t("chat.chatName")}
              className="h-7 max-w-[480px] rounded-md bg-transparent px-1.5 text-sm font-semibold md:text-sm dark:bg-transparent"
            />
          ) : (
            <button
              type="button"
              title={t("chat.rename")}
              onClick={startEdit}
              className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate text-sm font-semibold text-foreground">{displayTitle || t("common.untitledChat")}</span>
              <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          )}
          <HeaderMeta
            agentLabel={agentMeta.label}
            agent={live.agent}
            model={live.model}
            effort={live.effort}
            cwd={live.cwd}
            device={device}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Status only while it says something: working, waiting for an approval, failed (not « Terminé »). */}
          {(statusMeta.active || live.status === "error") && (
            <Badge
              variant="outline"
              className={cn("hidden max-w-60 gap-1.5 bg-card sm:inline-flex", TONE_TEXT[statusMeta.tone])}
            >
              <StatusDot status={live.status} />
              <span className="truncate">{describeStatus(live.status, live.detail)}</span>
              {statusMeta.active && <LiveTimer startedAt={live.runStartedAt} className="font-sans text-muted-foreground" />}
            </Badge>
          )}
          <HeaderUsage agent={live.agent} model={live.model} tokens={live.tokens} costUsd={live.costUsd} />
          {live.hasContext && <ContextIndicator threadId={threadId} projectId={live.projectId} />}
          {statusMeta.active && (
            <Button
              variant="outline"
              size="sm"
              className="animate-in fade-in-0 zoom-in-95 duration-150 active:scale-[0.97]"
              onClick={() => void useChat.getState().stop(threadId)}
            >
              <Square className="fill-current" />
              {t("chat.stop")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("chat.chatActions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            {/* No focus back to the trigger on close: it would blur the rename field right away (= commit). */}
            <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem onClick={startEdit}>
                <Pencil />
                {t("chat.rename")}
              </DropdownMenuItem>
              <ThreadMoveSubmenu
                threadId={threadId}
                currentProjectId={live.projectId}
                device={device ?? deviceOfProject(live.projectId)}
              />
              {live.cwd && !device && (
                <DropdownMenuItem onClick={() => live.cwd && void openFolder(live.cwd)}>
                  <FolderOpen />
                  {t("common.openFolder")}
                </DropdownMenuItem>
              )}
              {live.projectId && (
                <DropdownMenuItem onClick={() => live.projectId && useUi.getState().openProject(live.projectId)}>
                  <FolderKanban />
                  {t("chat.openProject")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => useChatDeletion.getState().request(threadId)}>
                <Trash2 />
                {t("chat.deleteChat")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
});

function ThreadMoveSubmenu({
  threadId,
  currentProjectId,
  device,
}: {
  threadId: string;
  currentProjectId: string | null;
  device: string | null;
}) {
  const projects = useNav((s) => s.projects);
  const sameDeviceProjects = useMemo(
    () => projects.filter((p) => deviceOfProject(p.id) === device),
    [projects, device],
  );

  return (
    <DropdownMenuSub>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuSubTrigger>
            <FolderInput />
            <span>{t("chat.moveToProject")}</span>
          </DropdownMenuSubTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {t("chat.moveKeepContext")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
          {sameDeviceProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              disabled={currentProjectId === project.id}
              onSelect={() => void moveChatToProject(threadId, project.id)}
            >
              <Folder />
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
          {sameDeviceProjects.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            disabled={currentProjectId === null}
            onSelect={() => void moveChatToProject(threadId, null)}
          >
            <FolderMinus />
            <span>{t("chat.noProject")}</span>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** "Claude Code · Claude Opus 5.5 · Élevé · [PC] · 📁 neuron" */
const HeaderMeta = memo(function HeaderMeta({
  agentLabel,
  agent,
  model,
  effort,
  cwd,
  device,
}: {
  agentLabel: string;
  agent: Parameters<typeof findModel>[1];
  model: string | null;
  effort: string | null;
  cwd: string | null;
  device: string | null;
}) {
  const providers = useDeviceProviders(device);
  const modelInfo = findModel(providers, agent, model);
  // Antigravity families: the level is the selected variant's.
  const level =
    (modelInfo?.effortModels ? Object.entries(modelInfo.effortModels).find(([, id]) => id === model)?.[0] : undefined) ??
    effort;
  const parts = [agentLabel, modelInfo?.label ?? model ?? t("chat.defaultModel"), level ? effortLabel(level) : null].filter(
    (p): p is string => Boolean(p),
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate">{parts.join(" · ")}</span>
      <DeviceBadge device={device} />
      {cwd && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              {device ? (
                <span
                  tabIndex={0}
                  className="inline-flex min-w-0 shrink items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span aria-hidden>·</span>
                  <FolderOpen className="size-3 shrink-0" />
                  <span className="truncate font-mono">{folderName(cwd)}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void openFolder(cwd)}
                  aria-label={t("chat.openFolderOf", { path: cwd })}
                  className="inline-flex min-w-0 shrink items-center gap-1 rounded-sm outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span aria-hidden>·</span>
                  <FolderOpen className="size-3 shrink-0" />
                  <span className="truncate font-mono">{folderName(cwd)}</span>
                </button>
              )}
            </TooltipTrigger>
            <TooltipContent className="max-w-md flex-col items-start gap-0.5 break-all">
              <span className="font-mono">{cwd}</span>
              {!device && <span className="block opacity-70">{t("common.openFolder")}</span>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});
