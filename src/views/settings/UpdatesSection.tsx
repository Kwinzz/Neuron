import { useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useNow } from "@/hooks/useNow";
import { t } from "@/i18n";
import { formatPercent, formatRelative } from "@/lib/format";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { IS_WINDOWS } from "@/lib/platform";
import { toast } from "@/stores/toast";
import { useUpdate } from "@/stores/update";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { useSettingsPatch } from "./useSettingsPatch";

/** « vérifié il y a 3 min » (leaf: its own clock). */
function CheckedAgo({ at }: { at: number }) {
  const now = useNow(60_000);
  return <>{t("settings.updatesCheckedAgo", { time: formatRelative(at, now) })}</>;
}

/** Version, manual check, installation and the automatic check. */
export function UpdatesSection({ settings }: { settings: AppSettings }) {
  const patch = useSettingsPatch();
  const info = useUpdate((s) => s.info);
  const checking = useUpdate((s) => s.checking);
  const installing = useUpdate((s) => s.installing);
  const progress = useUpdate((s) => s.progress);
  const [error, setError] = useState<string | null>(null);
  const tauri = isTauri();

  const handleCheck = async () => {
    setError(null);
    try {
      const next = await useUpdate.getState().check();
      if (!next.available) toast({ tone: "ok", title: t("settings.updatesUpToDate", { version: next.current }) });
    } catch (err: unknown) {
      setError(ipcErrorMessage(err));
    }
  };

  const handleInstall = async () => {
    setError(null);
    try {
      await useUpdate.getState().install();
    } catch (err: unknown) {
      setError(ipcErrorMessage(err));
    }
  };

  const downloading =
    installing && progress !== null && progress.total !== null && progress.total > 0
      ? formatPercent(progress.downloaded / progress.total)
      : null;
  // Linux: downloaded, the package manager installs it (the desktop asks for the password meanwhile).
  const installingPackage =
    installing && progress !== null && progress.total !== null && progress.downloaded >= progress.total;

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("settings.updatesTitle")}</span>
          </CardTitle>
          <CardDescription className="text-xs">{t("settings.updatesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">
                {info?.available
                  ? t("settings.updatesAvailableTitle", { version: info.latest })
                  : info
                    ? t("settings.updatesUpToDate", { version: info.current })
                    : t("settings.updatesNeverChecked")}
              </span>
              <span className="text-xs text-muted-foreground">
                {info ? (
                  <>
                    {t("settings.updatesInstalled", { version: info.current })} · <CheckedAgo at={info.checkedAt} />
                  </>
                ) : null}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!tauri || checking || installing}
                onClick={() => void handleCheck()}
              >
                {checking ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden />
                )}
                <span>{t("settings.updatesCheck")}</span>
              </Button>
              {info?.available && (
                <Button type="button" size="sm" disabled={!tauri || installing} onClick={() => void handleInstall()}>
                  {installing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  <span>
                    {installingPackage
                      ? t("settings.updatesInstallingStep")
                      : downloading !== null
                        ? t("settings.updatesDownloading", { percent: downloading })
                        : t("settings.updatesInstall", { version: info.latest })}
                  </span>
                </Button>
              )}
            </div>
          </div>
          {info?.available && (
            <p className="text-xs text-muted-foreground">
              {IS_WINDOWS
                ? t("settings.updatesHowWindows")
                : info.inAppInstall
                  ? t("settings.updatesHowLinuxInApp")
                  : t("settings.updatesHowLinux")}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Separator />
          <SettingRow
            id="updates-auto"
            label={t("settings.updatesAuto")}
            description={t("settings.updatesAutoDescription")}
            control={
              <SettingSwitch
                id="updates-auto"
                checked={settings.updates.autoCheck}
                onCheckedChange={(autoCheck) => void patch((s) => ({ ...s, updates: { ...s.updates, autoCheck } }))}
                aria-describedby="updates-auto-desc"
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
