import { useNow } from "@/hooks/useNow";
import { formatCountdown } from "@/lib/format";

interface ResetCountdownProps {
  resetsAt: number;
}

export function ResetCountdown({ resetsAt }: ResetCountdownProps) {
  const now = useNow(60_000);
  return (
    <span className="text-xs text-fg-muted">
      Réinit. dans <span className="font-bold tabular-nums text-fg">{formatCountdown(resetsAt - now)}</span>
    </span>
  );
}
