import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

export function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-5 py-2" aria-label={t("chat.historyLoading")}>
      <Skeleton className="h-11 w-1/3 self-end rounded-2xl" />

      <div className="flex w-3/4 flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
      </div>

      <Skeleton className="h-10 w-full rounded-lg" />

      <Skeleton className="h-10 w-1/4 self-end rounded-2xl" />

      <div className="flex w-4/5 flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}
