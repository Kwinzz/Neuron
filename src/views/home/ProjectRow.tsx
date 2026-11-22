import { memo } from "react";
import { Progress } from "@/components/legacy/Progress";
import { formatCost, formatTokens } from "@/lib/format";

interface ProjectRowProps {
  name: string;
  tokens: number;
  costUsd: number;
  share: number;
}

export const ProjectRow = memo(function ProjectRow({
  name,
  tokens,
  costUsd,
  share,
}: ProjectRowProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-bold text-fg">{name}</span>
        <span className="shrink-0 text-right">
          <span className="text-sm font-bold tabular-nums text-fg">{formatTokens(tokens)}</span>
          <span className="ml-2 text-xs tabular-nums text-fg-muted">{formatCost(costUsd)}</span>
        </span>
      </div>
      <Progress
        className="mt-2"
        size="sm"
        value={share}
        fillClassName="bg-hl-2"
        label={`Part du projet ${name}`}
      />
    </div>
  );
});
