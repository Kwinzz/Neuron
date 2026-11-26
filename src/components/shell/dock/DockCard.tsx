import { memo, useMemo } from "react";
import { cn } from "cn";
import { ArrowUpRight, GitFork, Square } from "lucide-react";
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

  const runningSubagents = useMemo(() => {
    let count = 0;
    for (const sub of Object.values(subs)) {
      if (sub.status === "running") count++;
    }
    return count;
  }, [subs]);

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
        {runningSubagents > 0 && (
          <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 text-[10px] tabular-nums animate-in fade-in-0 duration-150">
            <GitFork className="size-3" aria-hidden />
            {t("shell.subagentCount", { n: runningSubagents })}
          </Badge>
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
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot status={thread.status} />
        <span className={cn("shrink-0", TONE_TEXT[meta.tone])}>{meta.label}</span>
        {device && <DeviceBadge device={device} className="max-w-28 text-[11px]" />}
        {thread.projectName && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate" title={thread.projectName}>
              {thread.projectName}
            </span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
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
    </div>
  );
});

function EndedAgo({ ts }: { ts: number }) {
  const now = useNow(30_000);
  return <span>{formatRelative(ts, now)}</span>;
}
