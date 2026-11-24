import { memo, useMemo, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { parseUnifiedDiff } from "./diffRows";
import { t } from "@/i18n";

/** Rows shown before « Afficher tout ». */
const VISIBLE_ROWS = 300;

const ROW_TONE = {
  add: "bg-ok/10 text-foreground",
  del: "bg-destructive/10 text-foreground",
  ctx: "text-muted-foreground",
} as const;
const MARK = { add: "+", del: "−", ctx: " " } as const;
const MARK_TONE = { add: "text-ok", del: "text-destructive", ctx: "text-muted-foreground/50" } as const;

/** Code block of a file modification: line numbers, added/removed lines, collapsed unchanged parts. */
export const UnifiedDiff = memo(function UnifiedDiff({ diff, truncated }: { diff: string; truncated?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="max-h-[420px] overflow-auto font-mono text-xs leading-5 select-text">
        <table className="w-full border-collapse">
          <tbody>
            {visible.map((row, i) =>
              row.kind === "gap" ? (
                <tr key={i} className="bg-muted/40 text-muted-foreground select-none">
                  <td colSpan={4} className="px-3 py-0.5 text-[11px]">
                    ⋯ {row.count != null ? t("chat.unchangedLines", { n: row.count }) : ""}
                  </td>
                </tr>
              ) : (
                <tr key={i} className={ROW_TONE[row.kind]}>
                  <td className="w-px select-none pl-3 pr-1.5 text-right tabular-nums text-muted-foreground/60">
                    {row.oldNo ?? ""}
                  </td>
                  <td className="w-px select-none pr-2 text-right tabular-nums text-muted-foreground/60">
                    {row.newNo ?? ""}
                  </td>
                  <td className={cn("w-px select-none pr-2", MARK_TONE[row.kind])}>{MARK[row.kind]}</td>
                  <td className="whitespace-pre pr-3">{row.text || " "}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {(rows.length > VISIBLE_ROWS || truncated) && (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {rows.length > VISIBLE_ROWS && (
            <Button
              variant="link"
              size="xs"
              onClick={() => setExpanded((v) => !v)}
              className="h-auto px-0 text-muted-foreground hover:text-foreground"
            >
              {expanded ? t("chat.collapse") : t("chat.showAllLines", { n: rows.length })}
            </Button>
          )}
          {truncated && <span>{t("chat.diffTruncated")}</span>}
        </div>
      )}
    </div>
  );
});
