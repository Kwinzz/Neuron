import { formatCost, formatInteger, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { computeDelta } from "./computeDelta";
import { KpiCard } from "./KpiCard";

export function SectionCards() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const totals = usage?.totals;
  const prev = usage?.previous;

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <KpiCard
        label="Tokens entrée"
        value={totals ? formatTokens(totals.input) : "—"}
        delta={totals && prev ? computeDelta(totals.input, prev.input) : null}
        detail="Prompts et contexte envoyés"
        loading={isLoading}
      />
      <KpiCard
        label="Tokens sortie"
        value={totals ? formatTokens(totals.output) : "—"}
        delta={totals && prev ? computeDelta(totals.output, prev.output) : null}
        detail="Réponses générées par les agents"
        loading={isLoading}
      />
      <KpiCard
        label="Coût estimé"
        value={totals ? formatCost(totals.costUsd) : "—"}
        delta={totals && prev ? computeDelta(totals.costUsd, prev.costUsd) : null}
        detail="Claude Code uniquement · Codex et Antigravity inclus dans l'abonnement"
        loading={isLoading}
      />
      <KpiCard
        label="Tours"
        value={totals ? formatInteger(totals.turns) : "—"}
        delta={totals && prev ? computeDelta(totals.turns, prev.turns) : null}
        detail="Échanges agent ↔ modèle"
        loading={isLoading}
      />
    </div>
  );
}
