import { memo, useState } from "react";
import { ChevronRight, FileMinus, FilePen, FilePlus } from "lucide-react";
import { cn } from "cn";
import type { FileChange } from "@/bindings/FileChange";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UnifiedDiff } from "./UnifiedDiff";
import { t } from "@/i18n";

const KIND = {
  add: { icon: FilePlus, label: "chat.fileAdded" },
  delete: { icon: FileMinus, label: "chat.fileDeleted" },
  update: { icon: FilePen, label: null },
} as const;

function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** One modified file: header (path, +/−) and its diff, open by default. */
export const FileEditBlock = memo(function FileEditBlock({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(true);
  const meta = KIND[change.kind as keyof typeof KIND] ?? KIND.update;
  const Icon = meta.icon;
  const { dir, name } = splitPath(change.path);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border bg-card animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted/50"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
            <span className="text-muted-foreground">{dir}</span>
            <span className="text-foreground">{name}</span>
          </span>
          {meta.label && <span className="shrink-0 text-xs text-muted-foreground">{t(meta.label)}</span>}
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium tabular-nums">
            <span className="text-ok">+{change.added}</span>
            <span className="text-destructive">−{change.removed}</span>
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-snappy",
              open && "rotate-90",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden border-t data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <UnifiedDiff diff={change.diff} truncated={change.truncated} />
      </CollapsibleContent>
    </Collapsible>
  );
});
