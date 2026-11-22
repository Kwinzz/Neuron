import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageRange } from "@/bindings/UsageRange";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AGENTS } from "@/lib/agents";
import { bucketTitle, formatTokens } from "@/lib/format";
import type { UsageRow } from "./useUsageChartData";

interface UsageTableProps {
  rows: UsageRow[];
  presentAgents: AgentKind[];
  range: UsageRange;
}

export function UsageTable({ rows, presentAgents, range }: UsageTableProps) {
  return (
    <div className="max-h-[250px] overflow-auto rounded-lg border">
      <Table>
        <caption className="sr-only">Consommation par période</caption>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Période</TableHead>
            {presentAgents.map((agent) => (
              <TableHead key={agent} className="text-right">
                {AGENTS[agent].label}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{bucketTitle(row.key, range)}</TableCell>
              {presentAgents.map((agent) => (
                <TableCell key={agent} className="text-right font-mono tabular-nums">
                  {formatTokens(row[agent])}
                </TableCell>
              ))}
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatTokens(row.total)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
