import type { AgentKind } from "@/bindings/AgentKind";
import { AGENTS } from "@/lib/agents";

interface AgentBadgeProps {
  agent: AgentKind;
  /** "dot" = colored dot only (label in title), "short" = dot + short name, "full" = dot + full name. */
  variant?: "dot" | "short" | "full";
  className?: string;
}

/** Agent identity: colored mark + text label (never color alone). */
export function AgentBadge({ agent, variant = "short", className = "" }: AgentBadgeProps) {
  const meta = AGENTS[agent];
  return (
    <span className={`inline-flex items-center gap-1.5 text-fg-muted ${className}`} title={meta.label}>
      <span className={`size-1.5 shrink-0 rounded-[2px] ${meta.bg}`} aria-hidden />
      {variant !== "dot" && <span className="truncate">{variant === "full" ? meta.label : meta.short}</span>}
    </span>
  );
}
