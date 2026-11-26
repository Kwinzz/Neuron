import { memo } from "react";
import { Monitor } from "lucide-react";
import { cn } from "cn";
import { t } from "@/i18n";
import { useDevices } from "@/stores/devices";

interface DeviceBadgeProps {
  /** Remote device node id, or null/undefined for this PC (renders nothing). */
  device: string | null | undefined;
  /** Icon only, with the device name (and offline state) in `title`. */
  compact?: boolean;
  className?: string;
}

/** Small pill showing which paired device hosts a chat or project. */
export const DeviceBadge = memo(function DeviceBadge({
  device,
  compact = false,
  className,
}: DeviceBadgeProps) {
  const name = useDevices((s) =>
    device ? s.devices?.hosts.find((h) => h.nodeId === device)?.name : undefined,
  );
  const connected = useDevices((s) =>
    device ? (s.devices?.hosts.find((h) => h.nodeId === device)?.connected ?? false) : true,
  );

  if (!device) return null;

  const label = name ?? t("shell.unknownDevice");
  const title = connected ? label : `${label} · ${t("shell.deviceOffline")}`;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border text-xs leading-none text-muted-foreground transition-opacity duration-150",
        compact ? "px-1 py-0.5" : "max-w-36 px-1.5 py-0.5",
        !connected && "opacity-60",
        className,
      )}
    >
      <Monitor className="size-3 shrink-0" aria-hidden />
      {compact ? <span className="sr-only">{title}</span> : <span className="truncate">{label}</span>}
    </span>
  );
});
