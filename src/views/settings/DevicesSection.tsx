import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { AddDeviceDialog } from "./AddDeviceDialog";
import { DeviceAccessCard } from "./DeviceAccessCard";
import { DeviceClientsCard } from "./DeviceClientsCard";
import { DeviceGrantsCard } from "./DeviceGrantsCard";
import { DeviceHostsCard } from "./DeviceHostsCard";
import { DevicePairingCard } from "./DevicePairingCard";
import { SettingsSkeleton } from "./SettingsSkeleton";

/** Paired devices: local-network access, pairing code, controlling clients and controlled hosts. */
export function DevicesSection() {
  const status = useDevices((s) => s.status);
  const loaded = useDevices((s) => s.loaded);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const tauri = isTauri();

  const loadDevices = useCallback(() => {
    if (!isTauri()) return;
    setLoadError(null);
    void useDevices
      .getState()
      .load()
      .catch((err: unknown) => {
        setLoadError(ipcErrorMessage(err));
      });
  }, []);

  useEffect(() => {
    if (tauri && !useDevices.getState().loaded) {
      loadDevices();
    }
  }, [tauri, loadDevices]);

  if (tauri && loadError !== null && status === null) {
    return (
      <Alert variant="destructive" className="has-data-[slot=alert-action]:pr-28">
        <AlertCircle aria-hidden />
        <AlertTitle>{t("settings.devicesUnavailable")}</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
        <AlertAction>
          <Button type="button" size="xs" variant="outline" onClick={loadDevices}>
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (tauri && !loaded) {
    return <SettingsSkeleton />;
  }

  const enabled = status?.settings.enabled ?? false;

  return (
    <>
      <div className="flex flex-col gap-4">
        <DeviceAccessCard />
        {enabled && <DevicePairingCard />}
        <DeviceClientsCard />
        <DeviceGrantsCard />
        <DeviceHostsCard onAddDevice={() => setAddOpen(true)} />
      </div>

      <AddDeviceDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
