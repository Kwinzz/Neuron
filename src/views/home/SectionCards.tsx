import type { UsageSums } from "@/bindings/UsageSums";
import { formatCost, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { computeDelta } from "./computeDelta";
import { KpiCard } from "./KpiCard";

/** Every token, all providers: input + output + cache reads + cache writes. */
const allTokens = (u: UsageSums) => u.input + u.output + u.cacheRead + u.cacheWrite;

export function SectionCards() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const totals = usage?.totals;
  const prev = usage?.previous;

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <KpiCard
        index={0}
        label="Tokens entrée"
        value={totals ? formatTokens(totals.input) : "—"}
        delta={totals && prev ? computeDelta(totals.input, prev.input) : null}
        hint="Prompts et contexte envoyés (hors cache)"
        loading={isLoading}
      />
      <KpiCard
        index={1}
        label="Tokens sortie"
        value={totals ? formatTokens(totals.output) : "—"}
        delta={totals && prev ? computeDelta(totals.output, prev.output) : null}
        hint="Réponses générées par les agents"
        loading={isLoading}
      />
      <KpiCard
        index={2}
        label="Coût total"
        value={totals ? formatCost(totals.costUsd) : "—"}
        delta={totals && prev ? computeDelta(totals.costUsd, prev.costUsd) : null}
        hint="Tous fournisseurs, au tarif API : Claude tel que communiqué, Codex et Antigravity estimés depuis les tokens"
        loading={isLoading}
      />
      <KpiCard
        index={3}
        label="Tokens au total"
        value={totals ? formatTokens(allTokens(totals)) : "—"}
        delta={totals && prev ? computeDelta(allTokens(totals), allTokens(prev)) : null}
        hint="Tous fournisseurs : entrée, sortie, lectures et écritures de cache"
        loading={isLoading}
      />
    </div>
  );
}
