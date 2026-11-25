import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import type { PairingCode } from "@/bindings/PairingCode";
import type { RemoteClient } from "@/bindings/RemoteClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { toast } from "@/stores/toast";
import { PairingCountdown } from "./PairingCountdown";

const EMPTY_CLIENTS: readonly RemoteClient[] = [];

function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return code;
}

export function DevicePairingCard() {
  const status = useDevices((s) => s.status);
  const devices = useDevices((s) => s.devices);
  const tauri = isTauri();

  const pairing = status?.pairing ?? null;
  const clients = devices?.clients ?? EMPTY_CLIENTS;

  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  const prevPairingRef = useRef<PairingCode | null>(null);
  const clientsBeforePairingRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const prevPairing = prevPairingRef.current;

    if (prevPairing === null && pairing !== null) {
      clientsBeforePairingRef.current = new Set(clients.map((c) => c.nodeId));
    } else if (prevPairing !== null && pairing === null && clientsBeforePairingRef.current !== null) {
      const before = clientsBeforePairingRef.current;
      clientsBeforePairingRef.current = null;
      for (const client of clients) {
        if (!before.has(client.nodeId)) {
          toast({
            tone: "ok",
            title: t("settings.devicesPairedClient", { name: client.name }),
          });
        }
      }
    }

    prevPairingRef.current = pairing;
  }, [pairing, clients]);

  const activePairing =
    pairing !== null && pairing.expiresAt !== expiredAt && pairing.expiresAt > Date.now()
      ? pairing
      : null;

  const handleStart = async () => {
    if (!tauri || starting) return;
    setError(null);
    setExpiredAt(null);
    setStarting(true);
    try {
      await useDevices.getState().startPairing();
    } catch (err: unknown) {
      setError(ipcErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!tauri || cancelling) return;
    setError(null);
    setCancelling(true);
    clientsBeforePairingRef.current = null;
    try {
      await useDevices.getState().cancelPairing();
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.devicesPairCancelFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setCancelling(false);
    }
  };

  const handleExpired = useCallback(() => {
    if (pairing) setExpiredAt(pairing.expiresAt);
    void useDevices
      .getState()
      .load()
      .catch(() => undefined);
  }, [pairing]);

  return (
    <Card size="sm" className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("settings.devicesPairTitle")}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {t("settings.devicesPairDescription")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3">
        {activePairing === null ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!tauri || starting}
              title={!tauri ? t("settings.inAppOnly") : undefined}
              onClick={() => void handleStart()}
            >
              {starting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              <span>{t("settings.devicesPairAction")}</span>
            </Button>
            {error !== null && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span
                className="select-all font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums text-foreground"
                aria-live="polite"
              >
                {formatPairingCode(activePairing.code)}
              </span>
              <PairingCountdown expiresAt={activePairing.expiresAt} onExpired={handleExpired} />
            </div>

            <p className="text-xs text-muted-foreground">
              {t("settings.devicesPairInstructions")}
            </p>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelling}
                onClick={() => void handleCancel()}
              >
                {cancelling && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                <span>{t("common.cancel")}</span>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
