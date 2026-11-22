import { cn } from "cn";
import { useNow } from "@/hooks/useNow";
import { formatRelative } from "@/lib/format";

interface RelativeTimeProps {
  ts: number;
  className?: string;
}

export function RelativeTime({ ts, className }: RelativeTimeProps) {
  const now = useNow(60_000);
  return <span className={cn("font-mono tabular-nums", className)}>{formatRelative(ts, now)}</span>;
}
