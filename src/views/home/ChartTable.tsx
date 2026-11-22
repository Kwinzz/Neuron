import type { AgentKind } from "@/bindings/AgentKind";
import { AGENTS } from "@/lib/agents";
import { formatTokens } from "@/lib/format";

export interface ChartTableColumn {
  key: string;
  title: string;
  total: number;
  valuesByAgent: Partial<Record<AgentKind, number>>;
}

interface ChartTableProps {
  presentAgents: readonly AgentKind[];
  columns: readonly ChartTableColumn[];
}

export function ChartTable({ presentAgents, columns }: ChartTableProps) {
  return (
    <div className="max-h-[240px] overflow-auto">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Consommation par période</caption>
        <thead>
          <tr className="border-b border-line-chart/60 text-xs font-bold uppercase text-fg-muted">
            <th className="py-2 pr-3">Période</th>
            {presentAgents.map((agent) => (
              <th key={agent} className="px-2 py-2 text-right">
                {AGENTS[agent].label}
              </th>
            ))}
            <th className="py-2 pl-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => (
            <tr key={col.key} className="border-b border-line-chart/60 last:border-b-0">
              <td className="py-2 pr-3 text-fg">{col.title}</td>
              {presentAgents.map((agent) => (
                <td key={agent} className="px-2 py-2 text-right tabular-nums text-fg-muted">
                  {formatTokens(col.valuesByAgent[agent] ?? 0)}
                </td>
              ))}
              <td className="py-2 pl-3 text-right font-bold tabular-nums text-fg">
                {formatTokens(col.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
