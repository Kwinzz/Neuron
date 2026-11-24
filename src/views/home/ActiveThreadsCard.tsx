import { Coffee, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { useDashboard } from "@/stores/dashboard";
import { useUi } from "@/stores/ui";
import { ActiveThreadRow } from "./ActiveThreadRow";

export function ActiveThreadsCard() {
  const activeThreads = useDashboard((s) => s.snapshot?.activeThreads);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !activeThreads;

  const count = activeThreads?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home.activeTitle")}</CardTitle>
        {!isLoading && (
          <CardDescription>
            {t("home.activeCount", { n: count })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !activeThreads || activeThreads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center animate-in fade-in-0 duration-300">
            <div
              className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden
            >
              <Coffee className="size-5" />
            </div>
            <p className="font-medium">{t("home.activeEmptyTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("home.activeEmptyBody")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => useUi.getState().startChat(null)}
            >
              <Plus />
              {t("shell.navNewChat")}
            </Button>
          </div>
        ) : (
          <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto animate-in fade-in-0 duration-300">
            {activeThreads.map((th) => (
              <ActiveThreadRow key={th.id} id={th.id} fallback={th} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
