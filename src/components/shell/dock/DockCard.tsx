import { memo, useMemo } from "react";
import { cn } from "cn";
import { ArrowUpRight, ChevronDown, GitFork, Square, X } from "lucide-react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { StatusDot } from "@/components/ui/StatusDot";
import { useNow } from "@/hooks/useNow";
import { type MessageKey, t } from "@/i18n";
import { AGENTS } from "@/lib/agents";
import { deviceOfThread } from "@/lib/deviceRouting";
import { formatRelative, formatTokens } from "@/lib/format";
import { STATUS, TONE_TEXT } from "@/lib/status";
import { EMPTY_SUBAGENTS, useActivity } from "@/stores/activity";
import { useChat } from "@/stores/chat";
import { type Attention, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { DockTerminal } from "./DockTerminal";
import { orderedSubagents } from "./subagentMeta";
import { SubagentTerminal } from "./SubagentTerminal";

const ATTENTION_LABEL: Record<Attention, { text: MessageKey; className: string }> = {
  done: { text: "shell.attentionDone", className: "border-ok/40 text-ok" },
  approval: { text: "shell.attentionApproval", className: "border-warn/40 text-warn" },
  error: { text: "common.error", className: "border-destructive/40 text-destructive" },
};

/** Compact live card for a single chat in the dock, with its embedded mini terminal. */
export const DockCard = memo(function DockCard({ id }: { id: string }) {
  const thread = useLive((s) => s.threads[id]);
  const attention = useLive((s) => s.attention[id]);
  const focused = useUi((s) => s.focusedThreadId === id);
  const subs = useActivity((s) => s.subagents[id] ?? EMPTY_SUBAGENTS);
  const expanded = useUi((s) => s.dockExpanded[id] ?? false);

  const subList = useMemo(() => orderedSubagents(subs), [subs]);
  const runningSubagents = useMemo(() => subList.filter((sub) => sub.status === "running").length, [subList]);

  if (!thread) return null;

  const meta = STATUS[thread.status];
  const attn = attention ? ATTENTION_LABEL[attention] : null;
  const title = thread.title || t("common.untitledChat");
  const agentLabel = AGENTS[thread.agent].label;
  const device = deviceOfThread(id);

  const openChat = () => {
    useUi.getState().focusThread(id);
    useLive.getState().markSeen(id);
  };

  return (
    // Not role="button": a button's children are presentational, which would hide the nested actions and the
    // terminal from assistive tech. A focusable group that opens the chat on Enter/Space keeps them reachable.
    <div
      role="group"
      tabIndex={0}
      aria-label={t("shell.dockCardAria", { title, agent: agentLabel, status: meta.label })}
      aria-current={focused ? "true" : undefined}
      onClick={openChat}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openChat();
        }
      }}
      className={cn(
        "group flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border bg-card p-2.5 text-left outline-none",
        "transition-[background-color,border-color] duration-150 ease-snappy",
        "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
        focused && "border-ring/50 bg-accent/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0 items-center" title={agentLabel}>
          <AgentLogo agent={thread.agent} size={14} className="shrink-0" />
          <span className="sr-only">{agentLabel}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </span>
        {attn && (
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 px-1.5 text-[10px] animate-in zoom-in-50 fade-in-0 duration-150",
              attn.className,
            )}
          >
            {t(attn.text)}
          </Badge>
        )}
        {subList.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            title={expanded ? t("shell.subagentsToggleHide") : t("shell.subagentsToggleShow")}
            onClick={(e) => {
              e.stopPropagation();
              useUi.getState().setDockExpanded(id, !expanded);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors duration-150 animate-in fade-in-0",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:bg-accent",
              runningSubagents > 0 ? "border-live/40 text-foreground" : "text-muted-foreground",
              expanded && "bg-accent",
            )}
          >
            {runningSubagents > 0 ? (
              <span className="size-1.5 rounded-full bg-live animate-pulse" aria-hidden />
            ) : (
              <GitFork className="size-3" aria-hidden />
            )}
            {t("shell.subagentCount", { n: runningSubagents })}
            <ChevronDown
              className={cn("size-3 transition-transform duration-150", expanded && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("shell.openChat")}
            title={t("shell.openChat")}
            onClick={(e) => {
              e.stopPropagation();
              openChat();
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
          {meta.active && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 hover:text-destructive"
              aria-label={t("shell.stop")}
              title={t("shell.stop")}
              onClick={(e) => {
                e.stopPropagation();
                void useChat.getState().stop(id).catch(() => undefined);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Square className="size-3" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("shell.dockDismiss")}
            title={t("shell.dockDismiss")}
            onClick={(e) => {
              e.stopPropagation();
              useLive.getState().dismissFromDock(id);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <StatusDot status={thread.status} />
          <span className={cn("shrink-0", TONE_TEXT[meta.tone])}>{meta.label}</span>
          {device && <DeviceBadge device={device} className="max-w-24 text-[11px]" />}
          {(thread.projectName ?? thread.workspace?.projectName) && (
            <span
              className="min-w-0 truncate"
              title={thread.projectName ?? thread.workspace?.projectName ?? undefined}
            >
              · {thread.projectName ?? thread.workspace?.projectName}
            </span>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
          {meta.active ? (
            <LiveTimer startedAt={thread.runStartedAt} />
          ) : (
            <EndedAgo ts={thread.endedAt ?? thread.updatedAt} />
          )}
          <span aria-hidden>·</span>
          <span title={t("shell.tokensInOut")}>{formatTokens(thread.tokens)} tok</span>
        </span>
      </div>

      <DockTerminal
        id={id}
        title={title}
        active={meta.active}
        status={thread.status}
        detail={thread.status === "error" && thread.errorMessage ? thread.errorMessage : thread.detail}
      />

      {expanded && subList.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {subList.map((sub) => (
            <SubagentTerminal key={sub.id} threadId={id} sub={sub} />
          ))}
        </div>
      )}
    </div>
  );
});

function EndedAgo({ ts }: { ts: number }) {
  const now = useNow(30_000);
  return <span>{formatRelative(ts, now)}</span>;
}
