import { cn } from "cn";
import type { ContextSource } from "@/bindings/ContextSource";
import { SOURCE_ICON, SOURCE_LABEL } from "./sourceMeta";

interface SourceListProps {
  sources: ContextSource[];
  className?: string;
}

export function SourceList({ sources, className }: SourceListProps) {
  if (sources.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune source.</p>;
  }

  return (
    <ul className={cn("flex min-w-0 flex-col gap-2", className)}>
      {sources.map((source, index) => {
        const Icon = SOURCE_ICON[source.kind];
        return (
          <li key={`${source.kind}-${source.label}-${index}`} className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              title={SOURCE_LABEL[source.kind]}
            >
              <Icon className="size-3.5" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground" title={source.label}>
                {source.label}
              </span>
              {source.detail && (
                <span className="truncate font-mono text-xs text-muted-foreground" title={source.detail}>
                  {source.detail}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
