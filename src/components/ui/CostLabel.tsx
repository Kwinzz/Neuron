import { memo } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import { formatCost } from "@/lib/format";

const TITLE_REPORTED = "Coût au tarif API, communiqué par Claude Code (ton abonnement couvre l'usage réel).";
const TITLE_ESTIMATED = "Estimation au tarif API public du modèle, à partir des tokens (ton abonnement couvre l'usage réel).";
const TITLE_UNKNOWN = "Tarif inconnu pour ce modèle : coût non estimé.";
const TITLE_GENERIC = "CLI générique : pas de comptage de tokens.";

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
  if (agent === "generic") return <span title={TITLE_GENERIC}>—</span>;
  if (agent === "claude_code") return <span title={TITLE_REPORTED}>{formatCost(costUsd)}</span>;
  if (costUsd === 0 && tokens > 0) return <span title={TITLE_UNKNOWN}>—</span>;
  return <span title={TITLE_ESTIMATED}>≈ {formatCost(costUsd)}</span>;
});
