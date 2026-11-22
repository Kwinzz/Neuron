import { useMemo } from "react";
import { Card } from "@/components/legacy/Card";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { ProjectRow } from "./ProjectRow";
import { RANGE_LABEL } from "./rangeLabel";

export function ProjectsCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const rows = useMemo(() => {
    const byProject = usage?.byProject ?? [];
    let total = 0;
    const raw = byProject.map((p) => {
      const tokens = p.sums.input + p.sums.output;
      total += tokens;
      return {
        key: p.projectId ?? "__none__",
        name: p.name,
        tokens,
        costUsd: p.sums.costUsd,
      };
    });
    return raw.map((r) => ({
      ...r,
      share: total > 0 ? r.tokens / total : 0,
    }));
  }, [usage?.byProject]);

  return (
    <Card title="Par projet" subtitle={RANGE_LABEL[range]}>
      {isLoading ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Placeholder key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucune donnée par projet</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <ProjectRow
              key={r.key}
              name={r.name}
              tokens={r.tokens}
              costUsd={r.costUsd}
              share={r.share}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
