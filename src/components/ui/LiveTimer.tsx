import { useNow } from "@/hooks/useNow";
import { formatElapsed } from "@/lib/format";

interface LiveTimerProps {
  startedAt: number;
  /** When set, the timer is frozen at `endedAt - startedAt`. */
  endedAt?: number | null;
  className?: string;
}

/** Elapsed-time counter. Only this leaf re-renders each second (shared clock). */
export function LiveTimer({ startedAt, endedAt, className = "" }: LiveTimerProps) {
  return endedAt != null ? (
    <span className={`font-mono tabular-nums ${className}`}>{formatElapsed(endedAt - startedAt)}</span>
  ) : (
    <RunningTimer startedAt={startedAt} className={className} />
  );
}

function RunningTimer({ startedAt, className }: { startedAt: number; className: string }) {
  const now = useNow(1000);
  return <span className={`font-mono tabular-nums ${className}`}>{formatElapsed(now - startedAt)}</span>;
}
