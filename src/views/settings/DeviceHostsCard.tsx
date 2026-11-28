import { useState } from "react";
import { Laptop, Plus, Radio, Wrench, Zap } from "lucide-react";
import type { RemoteHost } from "@/bindings/RemoteHost";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { CardEmpty } from "@/views/project/CardEmpty";
import { DeviceConfirmDialog } from "./DeviceConfirmDialog";
import { DeviceStatusBadge } from "./DeviceStatusBadge";

const EMPTY_HOSTS: readonly RemoteHost[] = [];

interface DeviceHostsCardProps {
  onAddDevice: () => void;
}

export function DeviceHostsCard({ onAddDevice }: DeviceHostsCardProps) {
  const devices = useDevices((s) => s.devices);
  const capabilities = useDevices((s) => s.capabilities);
  const hosts = devices?.hosts ?? EMPTY_HOSTS;
  const tauri = isTauri();

  const [forgetTarget, setForgetTarget] = useState<RemoteHost | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const handleConfirmForget = async () => {
    if (!forgetTarget || forgetting) return;
    setForgetting(true);
    setForgetError(null);
    try {
      await useDevices.getState().forget(forgetTarget.nodeId);
      setForgetTarget(null);
    } catch (err: unknown) {
      setForgetError(ipcErrorMessage(err));
    } finally {
      setForgetting(false);
    }
  };

  return (
    <>
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("settings.devicesHostsTitle")}</span>
          </CardTitle>
          <CardDescription className="text-xs">
            {t("settings.devicesHostsDescription")}
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              disabled={!tauri}
              title={!tauri ? t("settings.inAppOnly") : undefined}
              onClick={onAddDevice}
            >
              <Plus className="size-3.5" aria-hidden />
              <span>{t("settings.devicesAddAction")}</span>
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {hosts.length === 0 ? (
            <CardEmpty icon={Laptop}>{t("settings.devicesHostsEmpty")}</CardEmpty>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2.5">
              {hosts.map((host) => (
                <li
                  key={host.nodeId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {host.name}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <DeviceStatusBadge connected={host.connected} lastSeen={host.lastSeen} />
                      {host.connected && host.path && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {host.path.viaRelay ? (
                            <Radio className="size-3 shrink-0" aria-hidden />
                          ) : (
                            <Zap className="size-3 shrink-0" aria-hidden />
                          )}
                          <span>
                            {t(host.path.viaRelay ? "settings.devicesPathRelay" : "settings.devicesPathDirect")}
                            {" · "}
                            <span className="font-mono tabular-nums">
                              {Math.round(host.path.rttMs)} ms
                            </span>
                          </span>
                        </span>
                      )}
                      {host.connected && capabilities[host.nodeId]?.workspaceTools && (
                        <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground">
                          <Wrench className="size-3 shrink-0" aria-hidden />
                          <span>{t("settings.devicesHostToolsReady")}</span>
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!tauri}
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setForgetError(null);
                      setForgetTarget(host);
                    }}
                  >
                    {t("settings.devicesForget")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DeviceConfirmDialog
        open={forgetTarget !== null}
        title={t("settings.devicesForgetTitle")}
        description={
          forgetTarget
            ? t("settings.devicesForgetDescription", { name: forgetTarget.name })
            : ""
        }
        confirmLabel={t("settings.devicesForget")}
        pending={forgetting}
        error={forgetError}
        onOpenChange={(open) => {
          if (!open) {
            setForgetTarget(null);
            setForgetError(null);
          }
        }}
        onConfirm={() => void handleConfirmForget()}
      />
    </>
  );
}
