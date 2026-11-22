import { cn } from "cn";
import { useNow } from "@/hooks/useNow";
import { formatRelative } from "@/lib/format";

const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

interface MemoryTimeProps {
  ts: number;
  className?: string;
}

export function MemoryTime({ ts, className }: MemoryTimeProps) {
  const now = useNow(60_000);
  const date = new Date(ts);
  return (
    <time
      dateTime={date.toISOString()}
      title={fullDateFormatter.format(date)}
      className={cn("font-mono tabular-nums", className)}
    >
      {formatRelative(ts, now)}
    </time>
  );
}
