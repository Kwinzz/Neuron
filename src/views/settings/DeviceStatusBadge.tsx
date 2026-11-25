import { cn } from "cn";
import { useNow } from "@/hooks/useNow";
import { t } from "@/i18n";
import { formatRelative } from "@/lib/format";

interface DeviceStatusBadgeProps {
  connected: boolean;
  lastSeen: number | null;
}

/** Leaf status indicator for a paired client or host. */
export function DeviceStatusBadge({ connected, lastSeen }: DeviceStatusBadgeProps) {
  const now = useNow(60_000);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-ok" : "bg-muted-foreground/50",
        )}
      />
      {connected ? (
        <span className="text-ok">{t("settings.devicesConnected")}</span>
      ) : lastSeen !== null ? (
        <span className="text-muted-foreground">
          {t("settings.devicesLastSeen", { time: formatRelative(lastSeen, now) })}
        </span>
      ) : (
        <span className="text-muted-foreground">{t("settings.devicesNeverConnected")}</span>
      )}
    </span>
  );
}
