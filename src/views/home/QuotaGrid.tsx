import { useDashboard } from "@/stores/dashboard";
import { QuotaCard } from "./QuotaCard";
import { SectionHeader } from "./SectionHeader";

export function QuotaGrid() {
  const providers = useDashboard((s) => s.snapshot?.providers);
  const loading = useDashboard((s) => s.loading);

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title="QUOTAS & ABONNEMENTS" />

      {loading && !providers ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex h-[120px] flex-col justify-between rounded-lg border border-line bg-surface p-3.5"
            >
              <div className="flex items-center justify-between">
                <div className="h-3 w-28 rounded-sm bg-surface-hover" />
                <div className="h-3 w-14 rounded-sm bg-surface-hover" />
              </div>
              <div className="h-6 w-36 rounded-sm bg-surface-hover" />
              <div className="h-1 w-full rounded-full bg-surface-hover" />
            </div>
          ))}
        </div>
      ) : !providers || providers.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-4 text-xs text-fg-subtle">
          Aucun fournisseur configuré
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {providers.map((u) => (
            <QuotaCard key={u.provider.id} usage={u} />
          ))}
        </div>
      )}
    </section>
  );
}
