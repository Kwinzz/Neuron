import { useNow } from "@/hooks/useNow";
import { locale, t } from "@/i18n";
import { formatRelative } from "@/lib/format";

interface ReportedAgoProps {
  /** When the agent reported its subscription windows (Unix ms). */
  reportedAt: number;
}

/** « mis à jour il y a 5 min »: how fresh the provider-reported bars are. */
export function ReportedAgo({ reportedAt }: ReportedAgoProps) {
  const now = useNow(60_000);
  if (reportedAt <= 0) return null;
  return (
    <span className="shrink-0 text-muted-foreground" title={new Date(reportedAt).toLocaleString(locale())}>
      {t("home.quotaUpdatedAgo", { time: formatRelative(reportedAt, now) })}
    </span>
  );
}
