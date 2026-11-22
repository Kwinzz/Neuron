import { useMemo } from "react";
import { Card } from "@/components/legacy/Card";
import { STATUS } from "@/lib/status";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { RecentThreadTableRow } from "./RecentThreadTableRow";

export function RecentThreadsCard() {
  const recentThreads = useDashboard((s) => s.snapshot?.recentThreads);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !recentThreads;

  const recent = useMemo(
    () => (recentThreads ?? []).filter((t) => !STATUS[t.status].active).slice(0, 8),
    [recentThreads],
  );

  const done = useMemo(() => recent.filter((t) => t.status === "done").length, [recent]);

  const subtitle = isLoading
    ? undefined
    : `${recent.length} ${recent.length <= 1 ? "thread" : "threads"} · ${done} ${
        done <= 1 ? "terminé" : "terminés"
      }`;

  return (
    <Card title="Threads récents" subtitle={subtitle}>
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Placeholder key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="flex flex-col gap-1 py-4">
          <p className="text-sm font-bold text-fg">Aucun thread récent</p>
          <p className="text-xs text-fg-muted">Les threads terminés apparaîtront ici.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-chart/60">
                <th className="pb-3 pr-3 text-xs font-bold uppercase tracking-wide text-fg-muted">
                  Thread
                </th>
                <th className="px-3 pb-3 text-xs font-bold uppercase tracking-wide text-fg-muted">
                  IA
                </th>
                <th className="px-3 pb-3 text-right text-xs font-bold uppercase tracking-wide text-fg-muted">
                  Tokens
                </th>
                <th className="px-3 pb-3 text-xs font-bold uppercase tracking-wide text-fg-muted">
                  Statut
                </th>
                <th className="pb-3 pl-3 text-right text-xs font-bold uppercase tracking-wide text-fg-muted">
                  Mis à jour
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <RecentThreadTableRow key={t.id} thread={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
