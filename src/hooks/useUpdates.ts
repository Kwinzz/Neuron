import { useEffect } from "react";
import { t } from "@/i18n";
import { events, isTauri, notify, UPDATE_NOTIFICATION_TARGET } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import { useUpdate } from "@/stores/update";

/**
 * Mount once (AppShell): last known update state, then `update://available` (announced once per version by the
 * backend's automatic check: notification + toast) and `update://progress` (installer download).
 */
export function useUpdates(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const keep = (fn: () => void) => {
      if (disposed) fn();
      else unlisten.push(fn);
    };

    void useUpdate
      .getState()
      .load()
      .catch(() => undefined);

    events
      .onUpdateAvailable((info) => {
        useUpdate.getState().setInfo(info);
        const title = t("settings.updatesAvailableTitle", { version: info.latest });
        const body = t("settings.updatesAvailableBody");
        toast({
          tone: "ok",
          title,
          description: body,
          onClick: () => useUi.getState().openSettings("updates"),
        });
        if (useSettings.getState().settings?.notifications.enabled === false) return;
        void notify.ensurePermission().then((ok) => {
          if (ok) notify.send(title, body, UPDATE_NOTIFICATION_TARGET);
        });
      })
      .then(keep)
      .catch(() => undefined);

    events
      .onUpdateProgress((progress) => useUpdate.getState().setProgress(progress))
      .then(keep)
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const fn of unlisten) fn();
    };
  }, []);
}
