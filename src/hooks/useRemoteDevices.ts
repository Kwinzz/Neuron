import { useEffect } from "react";
import { events, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";

const COALESCE_MS = 400;

/**
 * Mount once (AppShell): loads paired-device status on startup and coalesces `remote://status` /
 * `remote://resync` notifications into store reloads (at most once every 400 ms).
 */
export function useRemoteDevices(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      void useDevices
        .getState()
        .load()
        .catch(() => undefined);
    };

    const scheduleReload = () => {
      if (disposed || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) reload();
      }, COALESCE_MS);
    };

    reload();

    events
      .onRemoteChanged(scheduleReload)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unlisten?.();
    };
  }, []);
}
