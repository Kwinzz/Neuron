import { cn } from "cn";
import type { ContextSource } from "@/bindings/ContextSource";
import { t } from "@/i18n";
import { SourceBadge } from "./SourceBadge";

interface SourceListProps {
  sources: ContextSource[];
  className?: string;
}

export function SourceList({ sources, className }: SourceListProps) {
  if (sources.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("project.ctxNoSource")}</p>;
  }

  return (
    <ul className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {sources.map((source, index) => (
        <li key={`${source.kind}-${source.label}-${index}`} className="min-w-0">
          <SourceBadge source={source} />
        </li>
      ))}
    </ul>
  );
}
