import { ArrowDownToLine, ArrowUpFromLine, CircleDollarSign, Repeat } from "lucide-react";
import { formatCost, formatInteger, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { computeDelta } from "./computeDelta";
import { StatCard } from "./StatCard";

export function StatCards() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const totals = usage?.totals;
  const previous = usage?.previous;

  return (
    <div className="grid grid-cols-1 gap-[18px] @xl:grid-cols-2 @5xl:grid-cols-4">
      <StatCard
        label="Tokens entrée"
        value={totals ? formatTokens(totals.input) : "—"}
        delta={totals && previous ? computeDelta(totals.input, previous.input) : null}
        icon={<ArrowDownToLine size={22} />}
        loading={isLoading}
      />
      <StatCard
        label="Tokens sortie"
        value={totals ? formatTokens(totals.output) : "—"}
        delta={totals && previous ? computeDelta(totals.output, previous.output) : null}
        icon={<ArrowUpFromLine size={22} />}
        loading={isLoading}
      />
      <StatCard
        label="Coût estimé"
        value={totals ? formatCost(totals.costUsd) : "—"}
        delta={totals && previous ? computeDelta(totals.costUsd, previous.costUsd) : null}
        icon={<CircleDollarSign size={22} />}
        loading={isLoading}
      />
      <StatCard
        label="Tours"
        value={totals ? formatInteger(totals.turns) : "—"}
        delta={totals && previous ? computeDelta(totals.turns, previous.turns) : null}
        icon={<Repeat size={22} />}
        loading={isLoading}
      />
    </div>
  );
}
