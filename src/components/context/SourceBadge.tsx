import type { ContextSource } from "@/bindings/ContextSource";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { SOURCE_ICON, sourceLabel } from "./sourceMeta";

interface SourceBadgeProps {
  source: ContextSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const Icon = SOURCE_ICON[source.kind];
  const typeLabel = sourceLabel(source.kind);
  const ariaLabel = source.detail
    ? t("project.ctxSourceAriaDetail", { type: typeLabel, label: source.label, detail: source.detail })
    : t("project.ctxSourceAria", { type: typeLabel, label: source.label });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          aria-label={ariaLabel}
          className="max-w-64 min-w-0 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Icon className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-foreground">{source.label}</span>
          {source.detail && (
            <>
              <span className="shrink-0 text-muted-foreground" aria-hidden>
                ·
              </span>
              <span className="truncate text-muted-foreground tabular-nums">{source.detail}</span>
            </>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="flex max-w-xs flex-col items-start gap-0.5">
        <span className="font-medium">{typeLabel}</span>
        {source.detail && (
          <span className="font-mono text-[11px] opacity-80 wrap-anywhere">{source.detail}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
