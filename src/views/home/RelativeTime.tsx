import { useNow } from "@/hooks/useNow";
import { formatRelative } from "@/lib/format";

export function RelativeTime({ ts }: { ts: number }) {
  const now = useNow(60_000);
  return <span className="text-sm tabular-nums text-muted-foreground">{formatRelative(ts, now)}</span>;
}
