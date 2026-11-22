import { Card } from "@/components/legacy/Card";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { QuotaRow } from "./QuotaRow";

export function QuotasCard() {
  const providers = useDashboard((s) => s.snapshot?.providers);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !providers;

  const count = providers?.length ?? 0;
  const subtitle = isLoading
    ? undefined
    : `${count} ${count <= 1 ? "fournisseur" : "fournisseurs"}`;

  return (
    <Card title="Quotas & abonnements" subtitle={subtitle}>
      {isLoading ? (
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-2.5 border-b border-line-chart/60 py-4 first:pt-0 last:border-b-0 last:pb-0"
            >
              <Placeholder className="h-[30px] w-full" />
              <Placeholder className="h-[5px] w-full" />
              <Placeholder className="h-3.5 w-32" />
            </div>
          ))}
        </div>
      ) : !providers || providers.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucun fournisseur configuré</p>
      ) : (
        <div className="flex flex-col">
          {providers.map((u) => (
            <QuotaRow key={u.provider.id} usage={u} />
          ))}
        </div>
      )}
    </Card>
  );
}
