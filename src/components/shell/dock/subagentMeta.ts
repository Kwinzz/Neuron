import type { Vendor } from "@/components/ui/AgentLogo";
import { t } from "@/i18n";
import type { SubagentInfo } from "@/stores/activity";

interface CliMeta {
  label: string;
  vendor: Vendor;
}

/** Brand names are not translated. */
const CLIS: Record<string, CliMeta> = {
  claude: { label: "Claude Code", vendor: "anthropic" },
  codex: { label: "Codex", vendor: "openai" },
  antigravity: { label: "Antigravity", vendor: "google" },
  gemini: { label: "Gemini CLI", vendor: "google" },
  cursor: { label: "Cursor Agent", vendor: "other" },
  opencode: { label: "OpenCode", vendor: "other" },
  aider: { label: "Aider", vendor: "other" },
  qwen: { label: "Qwen Code", vendor: "other" },
  goose: { label: "Goose", vendor: "other" },
  amp: { label: "Amp", vendor: "other" },
  crush: { label: "Crush", vendor: "other" },
  copilot: { label: "Copilot CLI", vendor: "other" },
};

/** Who runs a sub-agent: an agent's own sub-agent (Claude Task, Antigravity) or another agent CLI. */
export function subagentMeta(sub: SubagentInfo): CliMeta {
  if (sub.source === "task") {
    // No agent: Claude's (older hosts never send it).
    const owner = sub.agent ? CLIS[sub.agent] : undefined;
    if (owner) return { label: sub.type ?? owner.label, vendor: owner.vendor };
    return { label: sub.type ?? t("shell.subagentClaude"), vendor: "anthropic" };
  }
  const known = sub.agent ? CLIS[sub.agent] : undefined;
  return known ?? { label: sub.agent ?? t("shell.subagentUnknown"), vendor: "other" };
}

/** Sub-agents in launch order. */
export function orderedSubagents(subs: Record<string, SubagentInfo>): SubagentInfo[] {
  return Object.values(subs).sort((a, b) => a.startedAt - b.startedAt);
}
