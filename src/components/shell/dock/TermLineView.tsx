import { memo } from "react";
import { cn } from "cn";
import { stripSummaryLine } from "@/lib/turnSummary";
import type { TermLine } from "@/stores/activity";

interface TermLineViewProps {
  line: TermLine;
  showResult: boolean;
}

function stripToolPrefix(tool: string | null, text: string): string {
  if (!tool) return text;
  if (text === tool) return "";
  const prefix = `${tool} `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** One line inside a dock mini terminal. */
export const TermLineView = memo(function TermLineView({ line, showResult }: TermLineViewProps) {
  if (line.kind === "status") {
    return (
      <div
        className="my-0.5 truncate text-center text-muted-foreground/60 animate-in fade-in-0 duration-150"
        title={line.text}
      >
        ── {line.text} ──
      </div>
    );
  }

  const tooltip = !showResult && line.result ? `${line.text}\n→ ${line.result}` : line.text;

  if (line.kind === "tool") {
    const isRunning = line.state === "running";
    const isError = line.state === "error";
    const rest = stripToolPrefix(line.tool, line.text);

    return (
      <div className="min-w-0 animate-in fade-in-0 duration-150">
        <div className="flex min-w-0 items-start gap-1.5" title={tooltip}>
          {isRunning ? (
            <span className="inline-flex h-[18px] w-3 shrink-0 items-center justify-center" aria-hidden>
              <span className="size-1.5 rounded-full bg-live animate-pulse" />
            </span>
          ) : isError ? (
            <span className="w-3 shrink-0 text-center text-destructive" aria-hidden>
              ✗
            </span>
          ) : (
            <span className="w-3 shrink-0 text-center text-ok" aria-hidden>
              ✓
            </span>
          )}
          <span className={cn("min-w-0 flex-1 truncate", isRunning ? "text-foreground" : "text-muted-foreground")}>
            {line.tool && (
              <span className={isRunning ? "text-foreground/70" : "text-muted-foreground"}>{line.tool}</span>
            )}
            {line.tool && rest ? " " : null}
            {rest}
          </span>
        </div>
        {showResult && line.result && (
          <div className="truncate pl-[18px] text-muted-foreground/60" title={line.result}>
            └ {line.result}
          </div>
        )}
      </div>
    );
  }

  if (line.kind === "text") {
    return (
      <div className="flex min-w-0 items-start gap-1.5" title={tooltip}>
        <span className="w-3 shrink-0 text-center text-muted-foreground/70" aria-hidden>
          ▍
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{stripSummaryLine(line.text)}</span>
      </div>
    );
  }

  if (line.kind === "thinking") {
    return (
      <div className="flex min-w-0 items-start gap-1.5 animate-in fade-in-0 duration-150" title={tooltip}>
        <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden>
          ∴
        </span>
        <span className="min-w-0 flex-1 truncate italic text-muted-foreground">
          <span className="italic">réflexion…</span>
          {line.text ? ` ${line.text}` : null}
        </span>
      </div>
    );
  }

  if (line.kind === "permission") {
    return (
      <div className="flex min-w-0 items-start gap-1.5 animate-in fade-in-0 duration-150" title={tooltip}>
        <span className="w-3 shrink-0 text-center text-warn" aria-hidden>
          ?
        </span>
        <span className="min-w-0 flex-1 truncate text-warn">Autorisation : {line.text}</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5 animate-in fade-in-0 duration-150" title={tooltip}>
      <span className="w-3 shrink-0 text-center text-destructive" aria-hidden>
        ✗
      </span>
      <span className="min-w-0 flex-1 truncate text-destructive">{line.text}</span>
    </div>
  );
});
