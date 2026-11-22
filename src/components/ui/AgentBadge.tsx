import type { AgentKind } from "@/bindings/AgentKind";
import { AGENTS } from "@/lib/agents";
import { AgentLogo } from "./AgentLogo";

interface AgentBadgeProps {
  agent: AgentKind;
  /** "dot" = logo only (label in title), "short" = logo + short name, "full" = logo + full name. */
  variant?: "dot" | "short" | "full";
  className?: string;
}

/** Agent identity: provider logo + text label (never color alone). */
export function AgentBadge({ agent, variant = "short", className = "" }: AgentBadgeProps) {
  const meta = AGENTS[agent];
  return (
    <span className={`inline-flex items-center gap-1.5 text-muted-foreground ${className}`} title={meta.label}>
      <AgentLogo agent={agent} size={12} className="shrink-0" />
      {variant !== "dot" && <span className="truncate">{variant === "full" ? meta.label : meta.short}</span>}
    </span>
  );
}
