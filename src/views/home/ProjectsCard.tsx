import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
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
    <Card>
      <CardHeader>
        <CardTitle>Par projet</CardTitle>
        <CardDescription>{RANGE_LABEL[range]}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-1 w-full" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune donnée par projet</p>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((r) => (
              <div key={r.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatTokens(r.tokens)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatCost(r.costUsd)}
                    </span>
                  </span>
                </div>
                <Progress
                  value={Math.min(100, r.share * 100)}
                  className="mt-2 h-1"
                  aria-label={`Part du projet ${r.name}`}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
