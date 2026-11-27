import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Laptop, Loader2 } from "lucide-react";
import type { NearbyDevice } from "@/bindings/NearbyDevice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useDevices } from "@/stores/devices";
import { toast } from "@/stores/toast";

const SCAN_INTERVAL_MS = 2500;

interface AddDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddDeviceDialog({ open, onOpenChange }: AddDeviceDialogProps) {
  const nearby = useDevices((s) => s.nearby);
  const devices = useDevices((s) => s.devices);
  const internet = useDevices((s) => s.status?.settings.internet ?? false);

  const [selected, setSelected] = useState<NearbyDevice | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [enablingInternet, setEnablingInternet] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setCodeInput("");
      setPairError(null);
      setScanError(null);
      setSubmitting(false);
      setInviteInput("");
      setInviteError(null);
      setInviteSubmitting(false);
      return;
    }
    if (!isTauri()) return;

    let cancelled = false;
    const scan = () => {
      void useDevices
        .getState()
        .scanNearby()
        .then(() => {
          if (!cancelled) setScanError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setScanError(ipcErrorMessage(err));
        });
    };

    scan();
    const timer = window.setInterval(scan, SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (selected !== null) {
      codeInputRef.current?.focus();
    }
  }, [selected]);

  const available = useMemo(() => {
    const knownHosts = new Set((devices?.hosts ?? []).map((host) => host.nodeId));
    return nearby.filter((device) => !knownHosts.has(device.nodeId));
  }, [nearby, devices]);

  const digits = codeInput.replace(/\D/g, "");
  const canSubmit = selected !== null && digits.length === 6 && !submitting;

  const handleCodeChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d\s]/g, "");
    if (cleaned.replace(/\D/g, "").length <= 6) {
      setCodeInput(cleaned);
      if (pairError !== null) setPairError(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || digits.length !== 6 || submitting) return;
    setSubmitting(true);
    setPairError(null);
    try {
      const pairedName = await useDevices.getState().pair(selected.nodeId, digits);
      toast({
        tone: "ok",
        title: t("settings.devicesPairedHost", { name: pairedName || selected.name }),
      });
      onOpenChange(false);
    } catch (err: unknown) {
      setPairError(ipcErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    const invite = inviteInput.trim();
    if (invite === "" || inviteSubmitting) return;
    setInviteSubmitting(true);
    setInviteError(null);
    try {
      const pairedName = await useDevices.getState().pairInvite(invite);
      toast({ tone: "ok", title: t("settings.devicesPairedHost", { name: pairedName }) });
      onOpenChange(false);
    } catch (err: unknown) {
      setInviteError(ipcErrorMessage(err));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleEnableInternet = async () => {
    if (enablingInternet) return;
    setEnablingInternet(true);
    setInviteError(null);
    try {
      await useDevices.getState().setInternet(true);
    } catch (err: unknown) {
      setInviteError(ipcErrorMessage(err));
    } finally {
      setEnablingInternet(false);
    }
  };

  const handleBack = () => {
    if (submitting) return;
    setSelected(null);
    setCodeInput("");
    setPairError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting && !inviteSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {selected === null ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("settings.devicesAddDialogTitle")}</DialogTitle>
              <DialogDescription>{t("settings.devicesAddDialogDescription")}</DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-3">
              {available.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  <span>{t("settings.devicesScanning")}</span>
                </div>
              ) : (
                <ul className="flex min-w-0 flex-col gap-1.5">
                  {available.map((device) => (
                    <li key={device.nodeId}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(device);
                          setCodeInput("");
                          setPairError(null);
                        }}
                        className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Laptop
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium text-foreground">
                              {device.name}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {device.nodeId.slice(0, 8)}
                            </span>
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {scanError !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {scanError}
                </p>
              )}

              <p className="text-xs text-muted-foreground">{t("settings.devicesAddHint")}</p>

              <div className="flex min-w-0 flex-col gap-2 border-t pt-3">
                <Label htmlFor="device-invite">{t("settings.devicesInviteTitle")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.devicesInviteDescription")}
                </p>
                {internet ? (
                  <form onSubmit={(e) => void handleInvite(e)} className="flex min-w-0 gap-2">
                    <Input
                      id="device-invite"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("settings.devicesInvitePlaceholder")}
                      value={inviteInput}
                      disabled={inviteSubmitting}
                      aria-invalid={inviteError !== null}
                      onChange={(e) => {
                        setInviteInput(e.target.value);
                        if (inviteError !== null) setInviteError(null);
                      }}
                      className="min-w-0 flex-1 font-mono text-xs"
                    />
                    <Button
                      type="submit"
                      disabled={inviteInput.trim() === "" || inviteSubmitting}
                    >
                      {inviteSubmitting && (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      )}
                      <span>{t("settings.devicesPairSubmit")}</span>
                    </Button>
                  </form>
                ) : (
                  <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {t("settings.devicesInviteNeedsInternet")}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={enablingInternet || !isTauri()}
                      onClick={() => void handleEnableInternet()}
                    >
                      {enablingInternet && (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      )}
                      <span>{t("settings.devicesInviteEnableInternet")}</span>
                    </Button>
                  </div>
                )}
                {inviteError !== null && (
                  <p role="alert" className="text-xs text-destructive">
                    {inviteError}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={inviteSubmitting}
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {t("settings.devicesEnterCode", { name: selected.name })}
              </DialogTitle>
              <DialogDescription>{t("settings.devicesEnterCodeHint")}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="device-pairing-code" className="sr-only">
                {t("settings.devicesEnterCode", { name: selected.name })}
              </Label>
              <Input
                ref={codeInputRef}
                id="device-pairing-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123 456"
                value={codeInput}
                disabled={submitting}
                aria-invalid={pairError !== null}
                onChange={(e) => handleCodeChange(e.target.value)}
                className="h-11 text-center font-mono text-xl tracking-[0.25em] tabular-nums"
              />
              {pairError !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {pairError}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={handleBack}
              >
                {t("common.back")}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                <span>{t("settings.devicesPairSubmit")}</span>
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
