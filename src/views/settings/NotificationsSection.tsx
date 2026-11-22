import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, CheckCircle2 } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isTauri, notify } from "@/lib/ipc";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { useSettingsPatch } from "./useSettingsPatch";

const TEST_FEEDBACK_MS = 3000;

interface NotificationsSectionProps {
  settings: AppSettings;
}

export function NotificationsSection({ settings }: NotificationsSectionProps) {
  const patch = useSettingsPatch();
  const notif = settings.notifications;
  const tauri = isTauri();

  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    if (!nextEnabled) {
      setPermissionBlocked(false);
      void patch((current) => ({
        ...current,
        notifications: { ...current.notifications, enabled: false },
      }));
      return;
    }

    const ok = await patch((current) => ({
      ...current,
      notifications: { ...current.notifications, enabled: true },
    }));
    if (!ok || !tauri) return;

    const granted = await notify.ensurePermission();
    setPermissionBlocked(!granted);
  };

  const handleToggleFlag = (
    key: "onPermission" | "onFinished" | "onError",
    value: boolean,
  ) => {
    void patch((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value },
    }));
  };

  const handleTest = async () => {
    if (!tauri || testing) return;
    setTesting(true);
    try {
      const granted = await notify.ensurePermission();
      if (!granted) {
        setPermissionBlocked(true);
        setTestSent(false);
        return;
      }
      setPermissionBlocked(false);
      notify.send("Neuron", "Les notifications fonctionnent.");
      setTestSent(true);
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null;
        setTestSent(false);
      }, TEST_FEEDBACK_MS);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Notifications</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Uniquement quand la fenêtre Neuron n&apos;est pas au premier plan.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-4">
        <SettingRow
          id="notif-enabled"
          label="Activer les notifications"
          description="Alertes système pour suivre l'activité des agents en arrière-plan"
          control={
            <SettingSwitch
              id="notif-enabled"
              checked={notif.enabled}
              onCheckedChange={(checked) => void handleToggleEnabled(checked)}
              aria-describedby="notif-enabled-desc"
            />
          }
        />

        {permissionBlocked && (
          <Alert className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <BellOff className="text-warn!" aria-hidden />
            <AlertTitle>Notifications bloquées</AlertTitle>
            <AlertDescription className="text-xs">
              Windows a bloqué les notifications de Neuron. Autorise-les dans Paramètres
              Windows › Système › Notifications.
            </AlertDescription>
          </Alert>
        )}

        <Separator />

        <div className="flex min-w-0 flex-col gap-3 pl-3">
          <SettingRow
            id="notif-permission"
            label="Demande d'autorisation"
            description="Un agent attend ton accord pour utiliser un outil"
            disabled={!notif.enabled}
            control={
              <SettingSwitch
                id="notif-permission"
                checked={notif.onPermission}
                disabled={!notif.enabled}
                onCheckedChange={(checked) => handleToggleFlag("onPermission", checked)}
                aria-describedby="notif-permission-desc"
              />
            }
          />
          <SettingRow
            id="notif-finished"
            label="Fin de réponse"
            description="Un agent a terminé sa réponse"
            disabled={!notif.enabled}
            control={
              <SettingSwitch
                id="notif-finished"
                checked={notif.onFinished}
                disabled={!notif.enabled}
                onCheckedChange={(checked) => handleToggleFlag("onFinished", checked)}
                aria-describedby="notif-finished-desc"
              />
            }
          />
          <SettingRow
            id="notif-error"
            label="Erreur"
            description="Un chat s'est arrêté sur une erreur"
            disabled={!notif.enabled}
            control={
              <SettingSwitch
                id="notif-error"
                checked={notif.onError}
                disabled={!notif.enabled}
                onCheckedChange={(checked) => handleToggleFlag("onError", checked)}
                aria-describedby="notif-error-desc"
              />
            }
          />
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!tauri || testing}
            title={!tauri ? "Disponible dans l'application" : undefined}
            onClick={() => void handleTest()}
          >
            <BellRing className="size-3.5" aria-hidden />
            <span>Tester</span>
          </Button>
          {testSent && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs text-ok animate-in fade-in-0 duration-150"
            >
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              <span>Notification envoyée</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
