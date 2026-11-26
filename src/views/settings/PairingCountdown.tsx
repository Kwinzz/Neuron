import { useEffect, useRef } from "react";
import { useNow } from "@/hooks/useNow";
import { t } from "@/i18n";

interface PairingCountdownProps {
  expiresAt: number;
  onExpired: () => void;
}

function formatMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Leaf clock component: ticks once per second so only the countdown re-renders. */
export function PairingCountdown({ expiresAt, onExpired }: PairingCountdownProps) {
  const now = useNow(1000);
  const remainingMs = Math.max(0, expiresAt - now);
  const expiredFiredRef = useRef<number | null>(null);

  useEffect(() => {
    if (remainingMs <= 0 && expiredFiredRef.current !== expiresAt) {
      expiredFiredRef.current = expiresAt;
      onExpired();
    }
  }, [expiresAt, onExpired, remainingMs]);

  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {t("settings.devicesCodeExpiresIn", { time: formatMmSs(remainingMs) })}
    </span>
  );
}
