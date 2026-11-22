import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS } from "@/lib/status";
import { useDashboard } from "@/stores/dashboard";
import { RecentThreadRow } from "./RecentThreadRow";

interface RecentThreadsCardProps {
  className?: string;
}

export function RecentThreadsCard({ className }: RecentThreadsCardProps) {
  const recentThreads = useDashboard((s) => s.snapshot?.recentThreads);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !recentThreads;

  const recent = useMemo(
    () => (recentThreads ?? []).filter((t) => !STATUS[t.status].active).slice(0, 8),
    [recentThreads],
  );

  const done = useMemo(() => recent.filter((t) => t.status === "done").length, [recent]);

  const description = isLoading
    ? undefined
    : `${recent.length} ${recent.length <= 1 ? "chat" : "chats"} · ${done} ${
        done <= 1 ? "terminé" : "terminés"
      }`;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Chats récents</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center text-muted-foreground">
            <p className="font-medium">Aucun chat récent</p>
            <p className="text-xs">Les chats terminés apparaîtront ici.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Chat</TableHead>
                  <TableHead>IA</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Mis à jour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((thread) => (
                  <RecentThreadRow key={thread.id} thread={thread} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
