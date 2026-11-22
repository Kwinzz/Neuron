import { memo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { IconBox } from "@/components/ui/IconBox";
import { Progress } from "@/components/legacy/Progress";
import { AGENTS } from "@/lib/agents";
import { formatPercent, formatTokens } from "@/lib/format";

interface AgentShareProps {
  agent: AgentKind;
  tokens: number;
  share: number;
}

export const AgentShare = memo(function AgentShare({ agent, tokens, share }: AgentShareProps) {
  const meta = AGENTS[agent];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <IconBox size={30} tone="muted">
          <span className="size-2.5 rounded-[3px]" style={{ background: meta.color }} />
        </IconBox>
        <span className="truncate text-sm font-bold text-fg-muted">{meta.short}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-lg font-bold tabular-nums text-fg">{formatTokens(tokens)}</span>
        <span className="text-xs tabular-nums text-fg-muted">{formatPercent(share)}</span>
      </div>
      <Progress
        className="mt-2"
        value={share}
        color={meta.color}
        label={`Part de ${meta.label}`}
      />
    </div>
  );
});
