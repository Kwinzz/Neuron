import { useCallback } from "react";
import type { AppSettings } from "@/bindings/AppSettings";
import { ipcErrorMessage } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/toast";

/*
 * Optimistic, serialized saves shared by every settings section.
 * - Each patch applies on top of the newest local value (including still-pending patches) and is shown at once.
 * - Saves run one after another, so the backend always receives them in click order.
 * - `save()` writes the stored value into the store; while newer patches are still queued, the newest
 *   optimistic value is re-applied so the UI never flickers back.
 * - When the queue drains after a failure, the store falls back to the last value the backend accepted.
 */
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let latest: AppSettings | null = null;
let confirmed: AppSettings | null = null;

export type SettingsPatch = (update: (s: AppSettings) => AppSettings) => Promise<boolean>;

export function useSettingsPatch(): SettingsPatch {
  return useCallback((update) => {
    const current = useSettings.getState().settings;
    if (!current) return Promise.resolve(false);

    if (pending === 0) confirmed = current;
    const next = update(current);
    latest = next;
    pending += 1;
    useSettings.setState({ settings: next });

    const run = queue.then(async (): Promise<boolean> => {
      let ok = false;
      try {
        confirmed = await useSettings.getState().save(next);
        ok = true;
      } catch (err: unknown) {
        toast({
          tone: "danger",
          title: "Impossible d'enregistrer les paramètres",
          description: ipcErrorMessage(err),
        });
      }
      pending -= 1;
      if (pending > 0) {
        if (latest) useSettings.setState({ settings: latest });
      } else if (!ok && confirmed) {
        useSettings.setState({ settings: confirmed });
      }
      return ok;
    });

    queue = run;
    return run;
  }, []);
}
