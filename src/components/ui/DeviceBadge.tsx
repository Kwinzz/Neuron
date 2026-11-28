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
  const viaRelay = useDevices((s) =>
    device ? s.devices?.hosts.find((h) => h.nodeId === device)?.path?.viaRelay : undefined,
  );
  const rttMs = useDevices((s) =>
    device ? s.devices?.hosts.find((h) => h.nodeId === device)?.path?.rttMs : undefined,
  );

  if (!device) return null;

  const label = name ?? t("shell.unknownDevice");
  let title: string;
  if (!connected) {
    title = `${label} · ${t("shell.deviceOffline")}`;
  } else if (viaRelay !== undefined && rttMs !== undefined) {
    const pathLabel = t(viaRelay ? "shell.devicePathRelay" : "shell.devicePathDirect");
    title = `${label} · ${pathLabel} · ${Math.round(rttMs)} ms`;
  } else {
    title = label;
  }

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border text-xs leading-none text-muted-foreground transition-opacity duration-150",
        compact ? "shrink-0 px-1 py-0.5" : "min-w-0 max-w-36 shrink px-1.5 py-0.5",
        !connected && "opacity-60",
        className,
      )}
    >
      <Monitor className="size-3 shrink-0" aria-hidden />
      {compact ? <span className="sr-only">{title}</span> : <span className="truncate">{label}</span>}
    </span>
  );
});
