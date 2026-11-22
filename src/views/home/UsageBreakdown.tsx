import type { AgentUsage } from "@/bindings/AgentUsage";
import type { ProjectUsage } from "@/bindings/ProjectUsage";
import { BreakdownRow } from "./BreakdownRow";

interface UsageBreakdownProps {
  byAgent: AgentUsage[];
  byProject: ProjectUsage[];
}

export function UsageBreakdown({ byAgent, byProject }: UsageBreakdownProps) {
  const maxAgent = Math.max(
    1,
    ...byAgent.map((a) => a.sums.input + a.sums.output),
  );
  const maxProject = Math.max(
    1,
    ...byProject.map((p) => p.sums.input + p.sums.output),
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">PAR IA</h3>
        {byAgent.length === 0 ? (
          <p className="text-xs text-fg-subtle">Aucune donnée</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {byAgent.map((entry) => {
              const tokens = entry.sums.input + entry.sums.output;
              return (
                <BreakdownRow
                  key={entry.agent}
                  agent={entry.agent}
                  tokens={tokens}
                  costUsd={entry.sums.costUsd}
                  ratio={tokens / maxAgent}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          PAR PROJET
        </h3>
        {byProject.length === 0 ? (
          <p className="text-xs text-fg-subtle">Aucune donnée</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {byProject.map((proj) => {
              const tokens = proj.sums.input + proj.sums.output;
              return (
                <BreakdownRow
                  key={proj.projectId ?? "__none__"}
                  label={proj.name}
                  tokens={tokens}
                  costUsd={proj.sums.costUsd}
                  ratio={tokens / maxProject}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
