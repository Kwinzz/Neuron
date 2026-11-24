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
import { t } from "@/i18n";
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
    () => (recentThreads ?? []).filter((th) => !STATUS[th.status].active).slice(0, 8),
    [recentThreads],
  );

  const done = useMemo(() => recent.filter((th) => th.status === "done").length, [recent]);

  const description = isLoading
    ? undefined
    : `${t("home.recentChatCount", { n: recent.length })} · ${t("home.recentDoneCount", { n: done })}`;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("home.recentTitle")}</CardTitle>
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
          <div className="flex flex-col items-center gap-1 py-8 text-center text-muted-foreground animate-in fade-in-0 duration-300">
            <p className="font-medium">{t("home.recentEmptyTitle")}</p>
            <p className="text-xs">{t("home.recentEmptyBody")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border animate-in fade-in-0 duration-300">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("home.colChat")}</TableHead>
                  <TableHead>{t("home.colAgent")}</TableHead>
                  <TableHead>{t("home.colStatus")}</TableHead>
                  <TableHead className="text-right">{t("home.colTokens")}</TableHead>
                  <TableHead className="text-right">{t("home.colUpdated")}</TableHead>
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
