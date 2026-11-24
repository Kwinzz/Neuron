import { cn } from "cn";
import { useNow } from "@/hooks/useNow";
import { formatRelative } from "@/lib/format";
import { locale } from "@/i18n";

/** Full date formatter of the current language (rebuilt after a language change). */
let fullDate: { locale: string; format: Intl.DateTimeFormat } | null = null;

function fullDateFormatter(): Intl.DateTimeFormat {
  const loc = locale();
  if (fullDate?.locale !== loc) {
    fullDate = { locale: loc, format: new Intl.DateTimeFormat(loc, { dateStyle: "long", timeStyle: "short" }) };
  }
  return fullDate.format;
}

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
      title={fullDateFormatter().format(date)}
      className={cn("font-mono tabular-nums", className)}
    >
      {formatRelative(ts, now)}
    </time>
  );
}
