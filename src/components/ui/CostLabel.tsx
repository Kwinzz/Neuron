import { memo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { t } from "@/i18n";
import { formatCost } from "@/lib/format";

/**
 * Dollar cost of a request or a chat, for every provider. Claude Code reports it; Codex and Antigravity only
 * report tokens, so the backend estimates it from the public API price (shown with « ≈ »).
 */
export const CostLabel = memo(function CostLabel({
  agent,
  costUsd,
  tokens,
}: {
  agent: AgentKind;
  costUsd: number;
  tokens: number;
}) {
  if (agent === "generic") return <span title={t("shell.costGeneric")}>—</span>;
  if (agent === "claude_code") return <span title={t("shell.costReported")}>{formatCost(costUsd)}</span>;
  if (costUsd === 0 && tokens > 0) return <span title={t("shell.costUnknown")}>—</span>;
  return <span title={t("shell.costEstimated")}>≈ {formatCost(costUsd)}</span>;
});
