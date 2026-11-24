import { memo, useMemo, useState } from "react";
import { cn } from "cn";
import { ChevronRight, GitBranch } from "lucide-react";
import { type MessageKey, t } from "@/i18n";
import { formatTokens } from "@/lib/format";
import type { SubagentInfo, TermLine } from "@/stores/activity";
import { TermLineView } from "./TermLineView";

interface SubagentLaneProps {
  sub: SubagentInfo;
  lines: TermLine[];
}

const MAX_VISIBLE = 4;

const SUB_STATUS_LABEL: Record<SubagentInfo["status"], MessageKey> = {
  running: "shell.subRunning",
  completed: "shell.subCompleted",
  failed: "shell.subFailed",
};

/** Collapsible indented lane for a sub-agent inside a chat's mini terminal. */
export const SubagentLane = memo(function SubagentLane({ sub, lines }: SubagentLaneProps) {
  const [open, setOpen] = useState(() => sub.status === "running");

  const { toolCount, visibleLines, hiddenCount } = useMemo(() => {
    const countedTools =
      sub.toolUses ?? lines.reduce((acc, line) => (line.kind === "tool" ? acc + 1 : acc), 0);
    const hidden = Math.max(0, lines.length - MAX_VISIBLE);
    const visible = hidden > 0 ? lines.slice(lines.length - MAX_VISIBLE) : lines;
    return { toolCount: countedTools, visibleLines: visible, hiddenCount: hidden };
  }, [sub.toolUses, lines]);

  return (
    <div className="my-0.5 ml-1.5 min-w-0 border-l border-border pl-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-foreground/80" title={sub.description}>
          {sub.description}
        </span>
        {sub.type && <span className="shrink-0 text-muted-foreground">· {sub.type}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono tabular-nums text-muted-foreground">
          {sub.status === "running" ? (
            <span className="size-1.5 rounded-full bg-live animate-pulse" aria-hidden />
          ) : sub.status === "completed" ? (
            <span className="text-ok" aria-hidden>
              ✓
            </span>
          ) : (
            <span className="text-destructive" aria-hidden>
              ✗
            </span>
          )}
          <span className="sr-only">{t(SUB_STATUS_LABEL[sub.status])}</span>
          <span>
            {t("shell.toolCount", { n: toolCount })}
          </span>
          {sub.tokens !== null && <span>· {formatTokens(sub.tokens)}</span>}
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <div className="mt-0.5 flex min-w-0 flex-col">
          {lines.length === 0 ? (
            <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
              <span className="w-3 shrink-0 text-center" aria-hidden>
                ›
              </span>
              <span className="min-w-0 flex-1 truncate">{sub.lastTool ?? t("shell.subStarting")}</span>
            </div>
          ) : (
            <>
              {hiddenCount > 0 && (
                <div className="pl-[18px] text-[10px] text-muted-foreground/60">
                  … {t("shell.hiddenLines", { n: hiddenCount })}
                </div>
              )}
              {visibleLines.map((line) => (
                <TermLineView key={line.id} line={line} showResult={false} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
});
