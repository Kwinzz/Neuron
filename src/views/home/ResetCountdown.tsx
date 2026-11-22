import { useNow } from "@/hooks/useNow";
import { formatCountdown } from "@/lib/format";

interface ResetCountdownProps {
  resetsAt: number;
}

export function ResetCountdown({ resetsAt }: ResetCountdownProps) {
  const now = useNow(60_000);
  return (
    <span className="text-muted-foreground">
      Réinit. dans{" "}
      <span className="font-mono font-medium tabular-nums text-foreground">
        {formatCountdown(resetsAt - now)}
      </span>
    </span>
  );
}
