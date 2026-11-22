import type { ContextSource } from "@/bindings/ContextSource";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SOURCE_ICON, SOURCE_LABEL } from "./sourceMeta";

interface SourceBadgeProps {
  source: ContextSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const Icon = SOURCE_ICON[source.kind];
  const badge = (
    <Badge
      variant="outline"
      tabIndex={source.detail ? 0 : undefined}
      aria-label={`${SOURCE_LABEL[source.kind]} : ${source.label}`}
      className="max-w-48 min-w-0 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Icon className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{source.label}</span>
    </Badge>
  );

  if (!source.detail) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs font-mono wrap-anywhere">{source.detail}</TooltipContent>
    </Tooltip>
  );
}
