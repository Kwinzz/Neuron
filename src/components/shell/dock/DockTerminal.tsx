import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { ArrowDown } from "lucide-react";
import type { ThreadStatus } from "@/bindings/ThreadStatus";
import { t } from "@/i18n";
import { describeStatus } from "@/lib/status";
import { EMPTY_LINES, EMPTY_SUBAGENTS, type SubagentInfo, useActivity } from "@/stores/activity";
import { SubagentLane } from "./SubagentLane";
import { orderedSubagents } from "./subagentMeta";
import { TermLineView } from "./TermLineView";

interface DockTerminalProps {
  id: string;
  title: string;
  active: boolean;
  status: ThreadStatus;
  detail: string | null;
}

const COLLAPSED_LINES = 3;

/** Compact live terminal log for a single chat in the dock. */
export const DockTerminal = memo(function DockTerminal({ id, title, active, status, detail }: DockTerminalProps) {
  const lines = useActivity((s) => s.lines[id] ?? EMPTY_LINES);
  const subs = useActivity((s) => s.subagents[id] ?? EMPTY_SUBAGENTS);

  const [expanded, setExpanded] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const { main, attached, orphanSubs, resultIds } = useMemo(() => {
    // A Claude sub-agent's own calls are in its terminal (expanded card), not in the chat's.
    const mainLines = lines.filter((line) => line.parentId === null);
    const mainIds = new Set(mainLines.map((l) => l.id));

    // Each sub-agent is mentioned under the line that launched it (process-tree ones: the shell call running when
    // they appeared; Antigravity's: their `invoke_subagent` call), or at the top when that line is gone.
    const byLine = new Map<string, SubagentInfo[]>();
    const orphans: SubagentInfo[] = [];
    for (const sub of orderedSubagents(subs)) {
      const anchor = sub.source === "process" ? sub.parentId : (sub.parentId ?? sub.id);
      if (anchor !== null && mainIds.has(anchor)) {
        const list = byLine.get(anchor);
        if (list) list.push(sub);
        else byLine.set(anchor, [sub]);
      } else {
        orphans.push(sub);
      }
    }

    const lastFinishedTools = new Set<string>();
    for (let i = mainLines.length - 1; i >= 0 && lastFinishedTools.size < 2; i--) {
      const l = mainLines[i];
      if (l && l.kind === "tool" && (l.state === "ok" || l.state === "error")) {
        lastFinishedTools.add(l.id);
      }
    }

    return { main: mainLines, attached: byLine, orphanSubs: orphans, resultIds: lastFinishedTools };
  }, [lines, subs]);

  const scrollable = active || expanded;

  useLayoutEffect(() => {
    if (!scrollable) return;
    const el = scrollRef.current;
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, subs, scrollable]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    pinnedRef.current = atBottom;
    setShowJump((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  const visibleMain = scrollable ? main : main.slice(-COLLAPSED_LINES);
  const visibleOrphans = scrollable ? orphanSubs : main.length === 0 ? orphanSubs.slice(-COLLAPSED_LINES) : [];
  const hasHiddenContent =
    !active && (main.length > COLLAPSED_LINES || (main.length > 0 ? orphanSubs.length > 0 : orphanSubs.length > COLLAPSED_LINES));
  const isEmpty = main.length === 0 && orphanSubs.length === 0;

  return (
    <div className="min-w-0">
      <div className="relative">
        <div
          ref={scrollRef}
          role="log"
          aria-live="off"
          aria-label={t("shell.terminalAria", { title })}
          onScroll={scrollable ? handleScroll : undefined}
          className={cn(
            "min-w-0 rounded-lg border bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground",
            "overflow-x-hidden",
            active ? "h-[120px] overflow-y-auto" : expanded ? "h-[160px] overflow-y-auto" : "overflow-y-hidden",
          )}
        >
          {isEmpty ? (
            active ? (
              <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
                <span className="inline-flex h-[18px] w-3 shrink-0 items-center justify-center" aria-hidden>
                  <span className="size-1.5 rounded-full bg-live animate-pulse" />
                </span>
                <span className="min-w-0 flex-1 truncate">{describeStatus(status, detail)}</span>
              </div>
            ) : (
              <div className="truncate text-muted-foreground/70">{t("shell.terminalEmpty")}</div>
            )
          ) : (
            <div className="flex min-w-0 flex-col">
              {visibleOrphans.map((sub) => (
                <SubagentLane key={sub.id} threadId={id} sub={sub} />
              ))}
              {visibleMain.map((line) => (
                <Fragment key={line.id}>
                  <TermLineView line={line} showResult={resultIds.has(line.id)} />
                  {attached.get(line.id)?.map((sub) => (
                    <SubagentLane key={sub.id} threadId={id} sub={sub} />
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {scrollable && showJump && (
          <button
            type="button"
            aria-label={t("shell.scrollToBottom")}
            onClick={(e) => {
              e.stopPropagation();
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              pinnedRef.current = true;
              setShowJump(false);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ArrowDown className="size-3" />
          </button>
        )}
      </div>

      {!active && (hasHiddenContent || expanded) && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              pinnedRef.current = true;
              setShowJump(false);
              setExpanded((v) => !v);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="rounded-sm px-1 text-[10px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {expanded ? t("shell.collapse") : t("shell.showAll")}
          </button>
        </div>
      )}
    </div>
  );
});
