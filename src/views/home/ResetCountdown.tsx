import { useNow } from "@/hooks/useNow";
import { formatCountdown } from "@/lib/format";

interface ResetCountdownProps {
  resetsAt: number;
}

export function ResetCountdown({ resetsAt }: ResetCountdownProps) {
  const now = useNow(60_000);
  return (
    <span className="text-[11px] text-fg-subtle">
      Réinit. dans <span className="font-mono tabular-nums">{formatCountdown(resetsAt - now)}</span>
    </span>
  );
}
