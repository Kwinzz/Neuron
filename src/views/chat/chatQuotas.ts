import { useMemo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { LiveWindow } from "@/bindings/LiveWindow";
import { t } from "@/i18n";
import { useDashboard } from "@/stores/dashboard";
import { findModel, useModels } from "@/stores/models";

export function quotaLabel(window: string): string {
  if (window === "five_hour") return t("chat.quota5h");
  if (window === "seven_day") return t("chat.quotaWeekly");
  if (window === "thirty_day") return t("chat.quota30d");
  return window;
}

/** Shown in this order: the 5 h and weekly windows (30 days when the plan only has that one). */
const ORDER = ["five_hour", "seven_day", "thirty_day"];

/** Fill color of a quota bar. */
export function quotaTone(utilization: number): string {
  if (utilization >= 0.9) return "bg-destructive";
  if (utilization >= 0.7) return "bg-warn";
  return "bg-ok";
}

/**
 * Providers with several quota groups (Antigravity: « Gemini Models », « Claude and GPT models »…): the group
 * whose models match the chat's model label, else the all-models windows (Claude, Codex), else the first group
 * (Antigravity's default model is a Gemini). `null` = the windows without a group.
 */
function groupFor(windows: LiveWindow[], modelLabel: string | null): string | null {
  const label = modelLabel?.toLowerCase() ?? "";
  const match = label
    ? windows.find((w) => w.models.some((m) => label.startsWith(m.toLowerCase())))?.group
    : undefined;
  if (match) return match;
  if (windows.some((w) => w.group === null)) return null;
  return windows[0]?.group ?? null;
}

/**
 * Subscription windows that apply to a chat (Claude: 5 h + weekly; Codex: per plan; Antigravity: the quota group of
 * the chat's model) and when they were reported. Empty when the provider reports none.
 */
export function useChatQuotas(
  agent: AgentKind,
  model: string | null,
): { windows: LiveWindow[]; reportedAt: number } {
  // `find` returns the store's own object: stable, no re-render loop.
  const quotas = useDashboard((s) => s.snapshot?.liveQuotas.find((q) => q.agent === agent));
  const modelLabel = useModels((s) => findModel(s.providers, agent, model)?.label ?? null);
  return useMemo(() => {
    if (!quotas) return { windows: [], reportedAt: 0 };
    const group = groupFor(quotas.windows, modelLabel);
    const windows = ORDER.map((name) => quotas.windows.find((w) => w.window === name && w.group === group)).filter(
      (w): w is LiveWindow => w !== undefined,
    );
    return { windows, reportedAt: quotas.reportedAt };
  }, [quotas, modelLabel]);
}
