import { useState } from "react";
import { Laptop, ShieldCheck } from "lucide-react";
import type { AccessLevel } from "@/bindings/AccessLevel";
import type { RemoteClient } from "@/bindings/RemoteClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t, type MessageKey } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { toast } from "@/stores/toast";
import { CardEmpty } from "@/views/project/CardEmpty";
import { DeviceConfirmDialog } from "./DeviceConfirmDialog";
import { DeviceStatusBadge } from "./DeviceStatusBadge";

const EMPTY_CLIENTS: readonly RemoteClient[] = [];

const ACCESS_LEVELS: readonly {
  value: AccessLevel;
  label: MessageKey;
  description: MessageKey;
}[] = [
  {
    value: "read",
    label: "settings.devicesLevelRead",
    description: "settings.devicesLevelReadDesc",
  },
  {
    value: "chat",
    label: "settings.devicesLevelChat",
    description: "settings.devicesLevelChatDesc",
  },
  {
    value: "full",
    label: "settings.devicesLevelFull",
    description: "settings.devicesLevelFullDesc",
  },
];

const LEVEL_LABEL: Record<AccessLevel, MessageKey> = {
  read: "settings.devicesLevelRead",
  chat: "settings.devicesLevelChat",
  full: "settings.devicesLevelFull",
};

function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "chat" || value === "full";
}

export function DeviceClientsCard() {
  const devices = useDevices((s) => s.devices);
  const clients = devices?.clients ?? EMPTY_CLIENTS;
  const tauri = isTauri();

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RemoteClient | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const handleLevelChange = async (client: RemoteClient, nextValue: string) => {
    if (!tauri || !isAccessLevel(nextValue) || nextValue === client.level) return;
    setUpdatingId(client.nodeId);
    try {
      await useDevices.getState().setLevel(client.nodeId, nextValue);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesLevelFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await useDevices.getState().revoke(revokeTarget.nodeId);
      setRevokeTarget(null);
    } catch (err: unknown) {
      setRevokeError(ipcErrorMessage(err));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <>
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("settings.devicesClientsTitle")}</span>
          </CardTitle>
          <CardDescription className="text-xs">
            {t("settings.devicesClientsDescription")}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {clients.length === 0 ? (
            <CardEmpty icon={Laptop}>{t("settings.devicesClientsEmpty")}</CardEmpty>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2.5">
              {clients.map((client) => (
                <li
                  key={client.nodeId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {client.name}
                    </span>
                    <DeviceStatusBadge connected={client.connected} lastSeen={client.lastSeen} />
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={client.level}
                      disabled={!tauri || updatingId === client.nodeId}
                      onValueChange={(value) => void handleLevelChange(client, value)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="min-w-28"
                        aria-label={t("settings.devicesLevelAria", { name: client.name })}
                      >
                        <SelectValue>{t(LEVEL_LABEL[client.level])}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end" className="w-64">
                        {ACCESS_LEVELS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="py-1.5">
                            <div className="flex flex-col text-left">
                              <span className="font-medium">{t(option.label)}</span>
                              <span className="text-xs text-muted-foreground">
                                {t(option.description)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!tauri}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        setRevokeError(null);
                        setRevokeTarget(client);
                      }}
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DeviceConfirmDialog
        open={revokeTarget !== null}
        title={t("settings.devicesRevokeTitle")}
        description={
          revokeTarget
            ? t("settings.devicesRevokeDescription", { name: revokeTarget.name })
            : ""
        }
        confirmLabel={t("common.remove")}
        pending={revoking}
        error={revokeError}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
        onConfirm={() => void handleConfirmRevoke()}
      />
    </>
  );
}
