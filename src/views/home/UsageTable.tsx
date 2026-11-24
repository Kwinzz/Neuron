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
import { t } from "@/i18n";
import { AGENTS } from "@/lib/agents";
import { bucketTitle } from "@/lib/format";
import { METRICS, type UsageMetric } from "./usageMetric";
import type { UsageRow } from "./useUsageChartData";

interface UsageTableProps {
  rows: UsageRow[];
  presentAgents: AgentKind[];
  range: UsageRange;
  metric: UsageMetric;
}

export function UsageTable({ rows, presentAgents, range, metric }: UsageTableProps) {
  const { format } = METRICS[metric];
  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border">
      <Table>
        <caption className="sr-only">{t("home.tableCaption")}</caption>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{t("home.colPeriod")}</TableHead>
            {presentAgents.map((agent) => (
              <TableHead key={agent} className="text-right">
                {AGENTS[agent].label}
              </TableHead>
            ))}
            <TableHead className="text-right">{t("home.total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{bucketTitle(row.key, range)}</TableCell>
              {presentAgents.map((agent) => (
                <TableCell key={agent} className="text-right font-mono tabular-nums">
                  {format(row[agent])}
                </TableCell>
              ))}
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {format(row.total)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
