import type { AgentKind } from "@/bindings/AgentKind";

export interface AgentMeta {
  label: string;
  short: string;
  /** Tailwind classes — static strings so Tailwind can detect them. */
  text: string;
  bg: string;
  border: string;
  /** CSS color value for SVG fills/strokes. */
  color: string;
}

/** FIXED order — charts stack and legends list agents in this order, never by rank. */
export const AGENT_ORDER: readonly AgentKind[] = ["claude_code", "antigravity", "codex", "generic"];

export const AGENTS: Record<AgentKind, AgentMeta> = {
  claude_code: {
    label: "Claude Code",
    short: "Claude",
    text: "text-agent-claude",
    bg: "bg-agent-claude",
    border: "border-agent-claude",
    color: "var(--color-agent-claude)",
  },
  antigravity: {
    label: "Antigravity",
    short: "Antigravity",
    text: "text-agent-antigravity",
    bg: "bg-agent-antigravity",
    border: "border-agent-antigravity",
    color: "var(--color-agent-antigravity)",
  },
  codex: {
    label: "Codex",
    short: "Codex",
    text: "text-agent-codex",
    bg: "bg-agent-codex",
    border: "border-agent-codex",
    color: "var(--color-agent-codex)",
  },
  generic: {
    label: "CLI générique",
    short: "CLI",
    text: "text-agent-generic",
    bg: "bg-agent-generic",
    border: "border-agent-generic",
    color: "var(--color-agent-generic)",
  },
};

/**
 * Whether the agent's CLI reports a cost in USD. Codex (ChatGPT plan) and Antigravity only report tokens:
 * their usage is included in the subscription, so we never show a fake "0 $".
 */
export function reportsCost(agent: AgentKind): boolean {
  return agent === "claude_code";
}

export const COST_NOT_REPORTED = "Ce CLI ne communique pas de coût : l'usage est inclus dans l'abonnement.";
