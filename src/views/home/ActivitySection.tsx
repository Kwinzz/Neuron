import { useMemo } from "react";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { STATUS } from "@/lib/status";
import { useDashboard } from "@/stores/dashboard";
import { ActiveThreadRow } from "./ActiveThreadRow";
import { RecentThreadRow } from "./RecentThreadRow";
import { SectionHeader } from "./SectionHeader";

export function ActivitySection() {
  const activeThreads = useDashboard((s) => s.snapshot?.activeThreads);
  const recentThreads = useDashboard((s) => s.snapshot?.recentThreads);
  const loading = useDashboard((s) => s.loading);

  const filteredRecent = useMemo(
    () => (recentThreads ?? []).filter((t) => !STATUS[t.status].active).slice(0, 8),
    [recentThreads],
  );

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title="ACTIVITÉ" />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            EN COURS
          </h3>

          {loading && !activeThreads ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-11 rounded-md bg-surface-hover" />
              ))}
            </div>
          ) : !activeThreads || activeThreads.length === 0 ? (
            <div className="flex flex-col gap-1 py-2">
              <p className="text-xs text-fg-muted">Aucun agent en cours</p>
              <p className="text-[11px] text-fg-subtle">
                Lancez un thread depuis la palette (<Kbd>{MOD_LABEL}</Kbd> <Kbd>K</Kbd>).
              </p>
            </div>
          ) : (
            <div className="flex max-h-[320px] flex-col gap-0.5 overflow-auto">
              {activeThreads.map((t) => (
                <ActiveThreadRow key={t.id} id={t.id} fallback={t} />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            RÉCENTS
          </h3>

          {loading && !recentThreads ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-11 rounded-md bg-surface-hover" />
              ))}
            </div>
          ) : filteredRecent.length === 0 ? (
            <div className="py-2">
              <p className="text-xs text-fg-subtle">Aucun thread récent</p>
            </div>
          ) : (
            <div className="flex max-h-[320px] flex-col gap-0.5 overflow-auto">
              {filteredRecent.map((t) => (
                <RecentThreadRow key={t.id} thread={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
