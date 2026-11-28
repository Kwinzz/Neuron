import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MonitorSmartphone } from "lucide-react";
import type { WorkspaceScope } from "@/bindings/WorkspaceScope";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { toast } from "@/stores/toast";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

function isWorkspaceScope(value: string): value is WorkspaceScope {
  return value === "project_only" || value === "full";
}

export function DeviceAccessCard() {
  const status = useDevices((s) => s.status);
  const tauri = isTauri();
  const enabled = status?.settings.enabled ?? false;
  const internet = status?.settings.internet ?? false;
  const allowRemoteTools = status?.settings.allowRemoteTools ?? false;
  const remoteToolsScope: WorkspaceScope = status?.settings.remoteToolsScope ?? "project_only";
  const savedName = status?.settings.deviceName ?? "";
  const nodeId = status?.nodeId ?? null;
  const port = status?.port ?? null;

  const [nameDraft, setNameDraft] = useState(savedName);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [savingInternet, setSavingInternet] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    setNameDraft(savedName);
  }, [savedName]);

  const handleToggleEnabled = async (next: boolean) => {
    if (!tauri || savingEnabled) return;
    setSavingEnabled(true);
    try {
      await useDevices.getState().setEnabled(next);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesUpdateFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSavingEnabled(false);
    }
  };

  const handleToggleInternet = async (next: boolean) => {
    if (!tauri || savingInternet) return;
    setSavingInternet(true);
    try {
      await useDevices.getState().setInternet(next);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesUpdateFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSavingInternet(false);
    }
  };

  const handleUpdateTools = async (nextEnabled: boolean, nextScope: WorkspaceScope) => {
    if (!tauri || savingTools) return;
    setSavingTools(true);
    try {
      await useDevices.getState().setTools(nextEnabled, nextScope);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesUpdateFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSavingTools(false);
    }
  };

  const commitName = async () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (!tauri || savingName) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(savedName);
      return;
    }
    if (trimmed === savedName) {
      if (nameDraft !== savedName) setNameDraft(savedName);
      return;
    }
    setSavingName(true);
    try {
      await useDevices.getState().setDeviceName(trimmed);
    } catch (err: unknown) {
      setNameDraft(savedName);
      toast({
        tone: "danger",
        title: t("settings.devicesUpdateFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSavingName(false);
    }
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      skipBlurRef.current = true;
      setNameDraft(savedName);
      e.currentTarget.blur();
    }
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("settings.devicesAccessTitle")}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-4">
        <SettingRow
          id="devices-allow-control"
          label={t("settings.devicesAllowControl")}
          description={t("settings.devicesAllowControlDescription")}
          disabled={!tauri}
          control={
            <SettingSwitch
              id="devices-allow-control"
              checked={enabled}
              disabled={!tauri || savingEnabled}
              onCheckedChange={(checked) => void handleToggleEnabled(checked)}
              aria-describedby="devices-allow-control-desc"
            />
          }
        />

        <Separator />

        <SettingRow
          id="devices-allow-internet"
          label={t("settings.devicesAllowInternet")}
          description={t("settings.devicesAllowInternetDescription")}
          disabled={!tauri}
          control={
            <SettingSwitch
              id="devices-allow-internet"
              checked={internet}
              disabled={!tauri || savingInternet}
              onCheckedChange={(checked) => void handleToggleInternet(checked)}
              aria-describedby="devices-allow-internet-desc"
            />
          }
        />

        <Separator />

        <SettingRow
          id="devices-allow-tools"
          label={t("settings.devicesAllowTools")}
          description={t("settings.devicesAllowToolsDescription")}
          disabled={!tauri}
          control={
            <SettingSwitch
              id="devices-allow-tools"
              checked={allowRemoteTools}
              disabled={!tauri || savingTools}
              onCheckedChange={(checked) => void handleUpdateTools(checked, remoteToolsScope)}
              aria-describedby="devices-allow-tools-desc"
            />
          }
        />

        {allowRemoteTools && (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <Label htmlFor="devices-tools-scope" className="text-xs font-medium text-foreground">
                {t("settings.devicesToolsScopeLabel")}
              </Label>
              <Select
                value={remoteToolsScope}
                disabled={!tauri || savingTools}
                onValueChange={(value) => {
                  if (isWorkspaceScope(value) && value !== remoteToolsScope) {
                    void handleUpdateTools(allowRemoteTools, value);
                  }
                }}
              >
                <SelectTrigger id="devices-tools-scope" size="sm" className="min-w-48">
                  <SelectValue>
                    {t(
                      remoteToolsScope === "full"
                        ? "settings.devicesToolsScopeFull"
                        : "settings.devicesToolsScopeProjects",
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" className="w-64">
                  <SelectItem value="project_only" className="py-1.5">
                    <div className="flex flex-col text-left">
                      <span className="font-medium">{t("settings.devicesToolsScopeProjects")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("settings.devicesToolsScopeProjectsDesc")}
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="full" className="py-1.5">
                    <div className="flex flex-col text-left">
                      <span className="font-medium">{t("settings.devicesToolsScopeFull")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("settings.devicesToolsScopeFullDesc")}
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.devicesToolsNote")}</p>
          </div>
        )}

        <Separator />

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Label htmlFor="devices-device-name" className="leading-snug text-foreground">
              {t("settings.devicesNameLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.devicesNameDescription")}
            </p>
          </div>
          <Input
            id="devices-device-name"
            value={nameDraft}
            disabled={!tauri || savingName}
            title={!tauri ? t("settings.inAppOnly") : undefined}
            placeholder={t("settings.devicesNamePlaceholder")}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={handleNameKeyDown}
            className="sm:w-56 sm:shrink-0"
          />
        </div>

        {nodeId && (
          <>
            <Separator />
            <div className="flex min-w-0 items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{t("settings.devicesIdLabel")}</span>
              <span className="font-mono text-xs text-muted-foreground" title={nodeId}>
                {nodeId.slice(0, 8)}
              </span>
            </div>
          </>
        )}

        {enabled && port !== null && (
          <>
            <Separator />
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{t("settings.devicesPortLabel")}</span>
                <span className="text-xs text-muted-foreground/80">
                  {t("settings.devicesPortHint", { port })}
                </span>
              </div>
              <span className="select-all font-mono text-xs tabular-nums text-muted-foreground">
                {port}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
