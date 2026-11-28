import { useState } from "react";
import { FolderKey, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { toast } from "@/stores/toast";

/** Active per-chat workspace grants issued by this device to paired AI hosts. Hidden when none exist. */
export function DeviceGrantsCard() {
  const grants = useDevices((s) => s.grants);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const tauri = isTauri();

  if (grants.length === 0) return null;

  const handleRevoke = async (grantId: string) => {
    if (!tauri || revokingId) return;
    setRevokingId(grantId);
    try {
      await useDevices.getState().revokeGrant(grantId);
      toast({ tone: "ok", title: t("settings.devicesGrantRevoked") });
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesGrantRevokeFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderKey className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("settings.devicesGrantsTitle")}</span>
        </CardTitle>
        <CardDescription className="text-xs">{t("settings.devicesGrantsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex min-w-0 flex-col gap-2">
          {grants.map((grant) => (
            <li
              key={grant.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {grant.peerName || grant.peerNodeId.slice(0, 8)}
                  </span>
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    {t(
                      grant.scope === "full"
                        ? "settings.devicesToolsScopeFull"
                        : "settings.devicesToolsScopeProjects",
                    )}
                  </Badge>
                </div>
                <span className="truncate font-mono text-xs text-muted-foreground" title={grant.rootCwd}>
                  {grant.rootCwd}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!tauri || revokingId === grant.id}
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void handleRevoke(grant.id)}
              >
                <X className="size-3.5" aria-hidden />
                <span>{t("settings.devicesGrantRevoke")}</span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
