import { useMemo, useState } from "react";
import { cn } from "cn";
import { diffLines } from "diff";
import { Button } from "@/components/ui/button";

const CONTEXT_KEEP = 3;
const CONTEXT_COLLAPSE_THRESHOLD = 8;
const MAX_VISIBLE_ROWS = 400;

type DiffRow =
  | { kind: "add" | "del" | "ctx"; text: string }
  | { kind: "gap"; count: number };

interface DiffViewProps {
  oldText: string;
  newText: string;
}

export function DiffView({ oldText, newText }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);

  const { rows, addedCount, removedCount } = useMemo(() => {
    const changes = diffLines(oldText, newText);
    const flat: Array<{ kind: "add" | "del" | "ctx"; text: string }> = [];
    let added = 0;
    let removed = 0;

    for (const part of changes) {
      if (!part.value) continue;
      const lines = part.value.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      const kind: "add" | "del" | "ctx" = part.added ? "add" : part.removed ? "del" : "ctx";
      for (const line of lines) {
        flat.push({ kind, text: line });
        if (kind === "add") added++;
        else if (kind === "del") removed++;
      }
    }

    const collapsed: DiffRow[] = [];
    let i = 0;
    while (i < flat.length) {
      const current = flat[i];
      if (!current) break;
      if (current.kind !== "ctx") {
        collapsed.push(current);
        i++;
        continue;
      }
      let end = i;
      while (end < flat.length && flat[end]?.kind === "ctx") end++;
      const runLen = end - i;
      if (runLen > CONTEXT_COLLAPSE_THRESHOLD) {
        for (let k = i; k < i + CONTEXT_KEEP; k++) {
          const r = flat[k];
          if (r) collapsed.push(r);
        }
        collapsed.push({ kind: "gap", count: runLen - CONTEXT_KEEP * 2 });
        for (let k = end - CONTEXT_KEEP; k < end; k++) {
          const r = flat[k];
          if (r) collapsed.push(r);
        }
      } else {
        for (let k = i; k < end; k++) {
          const r = flat[k];
          if (r) collapsed.push(r);
        }
      }
      i = end;
    }

    return { rows: collapsed, addedCount: added, removedCount: removed };
  }, [oldText, newText]);

  const truncated = !expanded && rows.length > MAX_VISIBLE_ROWS;
  const visible = truncated ? rows.slice(0, MAX_VISIBLE_ROWS) : rows;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 font-mono text-[11px] font-medium tabular-nums">
        <span className="text-ok">+{addedCount}</span>
        <span className="text-destructive">−{removedCount}</span>
      </div>
      <div className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 font-mono text-xs leading-relaxed select-text">
        {visible.map((row, idx) => {
          if (row.kind === "gap") {
            return (
              <div key={idx} className="bg-muted/50 px-3 py-0.5 text-muted-foreground select-none">
                ⋯ {row.count} lignes inchangées
              </div>
            );
          }
          const style =
            row.kind === "add"
              ? "bg-ok/10 text-ok"
              : row.kind === "del"
                ? "bg-destructive/10 text-destructive"
                : "text-muted-foreground";
          const gutter = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
          return (
            <div key={idx} className={cn("whitespace-pre px-3", style)}>
              <span className="mr-2 inline-block select-none opacity-75">{gutter}</span>
              {row.text || " "}
            </div>
          );
        })}
      </div>
      {rows.length > MAX_VISIBLE_ROWS && (
        <div>
          <Button
            variant="link"
            size="xs"
            onClick={() => setExpanded((v) => !v)}
            className="h-auto px-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Réduire" : `Afficher tout (${rows.length} lignes)`}
          </Button>
        </div>
      )}
    </div>
  );
}
