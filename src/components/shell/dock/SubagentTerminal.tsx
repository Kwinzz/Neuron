import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "cn";
import { VendorLogo } from "@/components/ui/AgentLogo";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { type MessageKey, t } from "@/i18n";
import { formatTokens } from "@/lib/format";
import { EMPTY_LINES, type SubagentInfo, type TermLine, useActivity } from "@/stores/activity";
import { subagentMeta } from "./subagentMeta";
import { TermLineView } from "./TermLineView";

const STATUS_LABEL: Record<SubagentInfo["status"], MessageKey> = {
  running: "shell.subRunning",
  completed: "shell.subCompleted",
  failed: "shell.subFailed",
};

/** Output lines shown at most for an agent CLI (the backend sends its last lines). */
const MAX_OUTPUT_LINES = 40;

/** Status mark of a sub-agent: live dot, ✓ or ✗ (with the status for screen readers). */
export function SubagentStatusMark({ status }: { status: SubagentInfo["status"] }) {
  return (
    <>
      {status === "running" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-live animate-pulse" aria-hidden />
      ) : status === "completed" ? (
        <span className="shrink-0 text-ok" aria-hidden>
          ✓
        </span>
      ) : (
        <span className="shrink-0 text-destructive" aria-hidden>
          ✗
        </span>
      )}
      <span className="sr-only">{t(STATUS_LABEL[status])}</span>
    </>
  );
}

/**
 * One sub-agent of a chat in the expanded dock card: header (who, what, status, time) and its own small terminal:
 * its tool calls for a Claude sub-agent, its command and last output lines for another agent CLI.
 */
export const SubagentTerminal = memo(function SubagentTerminal({ threadId, sub }: { threadId: string; sub: SubagentInfo }) {
  const all = useActivity((s) => (sub.source === "task" ? (s.lines[threadId] ?? EMPTY_LINES) : EMPTY_LINES));
  const meta = subagentMeta(sub);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const taskLines = useMemo(() => all.filter((l) => l.parentId === sub.id), [all, sub.id]);
  const outputLines = useMemo(
    () => (sub.output ? sub.output.split("\n").slice(-MAX_OUTPUT_LINES) : []),
    [sub.output],
  );
  const toolCount =
    sub.source === "task" ? (sub.toolUses ?? taskLines.filter((l: TermLine) => l.kind === "tool").length) : null;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [taskLines, outputLines, sub.status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  }, []);

  return (
    <div className="min-w-0 rounded-lg border bg-card/60 animate-in fade-in-0 duration-150">
      <div className="flex min-w-0 items-center gap-1.5 px-2 pt-1.5 text-[11px]">
        <VendorLogo vendor={meta.vendor} size={12} className="shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{meta.label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={sub.description}>
          {sub.description}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          <SubagentStatusMark status={sub.status} />
          {toolCount !== null && <span>{t("shell.toolCount", { n: toolCount })}</span>}
          {sub.tokens !== null && <span>· {formatTokens(sub.tokens)}</span>}
          <LiveTimer startedAt={sub.startedAt} endedAt={sub.endedAt} />
        </span>
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label={t("shell.subagentTerminalAria", { name: meta.label })}
        onScroll={onScroll}
        className="m-1.5 mt-1 h-[84px] min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-background/70 px-2 py-1 font-mono text-[10px] leading-[16px] text-muted-foreground"
      >
        {sub.source === "task" ? (
          taskLines.length === 0 ? (
            outputLines.length > 0 ? (
              // What it was asked (Antigravity: its calls are not streamed).
              outputLines.map((line, i) => (
                <div key={i} className="truncate" title={line}>
                  {line}
                </div>
              ))
            ) : (
              <div className="truncate">{sub.lastTool ?? t("shell.subStarting")}</div>
            )
          ) : (
            taskLines.map((line) => <TermLineView key={line.id} line={line} showResult={false} />)
          )
        ) : (
          <>
            {sub.command && (
              <div className="truncate text-foreground/80" title={sub.command}>
                <span className="text-muted-foreground/70">$ </span>
                {sub.command}
              </div>
            )}
            {outputLines.map((line, i) => (
              // Output lines have no identity of their own; their order never changes.
              <div key={i} className="truncate" title={line}>
                {line}
              </div>
            ))}
            {outputLines.length === 0 && (
              <div className={cn("truncate", sub.status === "running" ? "text-muted-foreground" : "text-muted-foreground/60")}>
                {sub.status === "running" ? t("shell.subagentWorking") : t("shell.subagentNoOutput")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
