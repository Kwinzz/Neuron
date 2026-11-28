import { memo } from "react";
import { ChevronDown, Cpu, Monitor } from "lucide-react";
import type { RemoteHost } from "@/bindings/RemoteHost";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { useDevices } from "@/stores/devices";

const EMPTY_HOSTS: readonly RemoteHost[] = [];
const LOCAL_VALUE = "__local__";

interface DevicePickerProps {
  value: string | null;
  onChange: (device: string | null) => void;
  disabled?: boolean;
  /** `"run"` = default single picker, `"ai"` = AI host picker, `"workspace"` = files/terminal device picker. */
  labelMode?: "run" | "ai" | "workspace";
}

/** Pick which device runs a chat or its AI/workspace (this PC or a paired host). Hidden when no host is paired. */
export const DevicePicker = memo(function DevicePicker({
  value,
  onChange,
  disabled,
  labelMode = "run",
}: DevicePickerProps) {
  const hosts = useDevices((s) => s.devices?.hosts) ?? EMPTY_HOSTS;

  if (hosts.length === 0) return null;

  const selectedHost = value ? hosts.find((h) => h.nodeId === value) : undefined;
  const currentName = value ? (selectedHost?.name ?? t("shell.unknownDevice")) : t("chat.thisPc");
  const Icon = labelMode === "ai" ? Cpu : Monitor;
  const labelKey =
    labelMode === "ai"
      ? "chat.aiDeviceLabel"
      : labelMode === "workspace"
        ? "chat.workspaceDeviceLabel"
        : "chat.runOnLabel";
  const buttonKey =
    labelMode === "ai" ? "chat.aiOn" : labelMode === "workspace" ? "chat.workspaceOn" : "chat.runOn";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 max-w-56 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground [&>svg:last-child]:transition-transform [&>svg:last-child]:duration-150 data-[state=open]:[&>svg:last-child]:rotate-180"
          aria-label={t(labelKey)}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t(buttonKey, { device: currentName })}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t(labelKey)}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? LOCAL_VALUE}
          onValueChange={(next) => onChange(next === LOCAL_VALUE ? null : next)}
        >
          <DropdownMenuRadioItem value={LOCAL_VALUE}>{t("chat.thisPc")}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {hosts.map((host) => (
            <DropdownMenuRadioItem key={host.nodeId} value={host.nodeId} disabled={!host.connected}>
              <span className="min-w-0 flex-1 truncate">{host.name}</span>
              {!host.connected && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {t("shell.deviceOffline")}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
