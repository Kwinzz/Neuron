import type { UsageRange } from "@/bindings/UsageRange";

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR");
const usd = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 3 });

/** 1234 → "1,2 k", 2_400_000 → "2,4 M". */
export function formatTokens(n: number): string {
  return Math.abs(n) < 1000 ? integer.format(n) : compact.format(n);
}

export function formatInteger(n: number): string {
  return integer.format(n);
}

export function formatCost(n: number): string {
  if (n === 0) return usd.format(0);
  return n < 1 ? usdSmall.format(n) : usd.format(n);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

/** Elapsed time for live timers: "0:42", "12:05", "1:02:09". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Remaining time: "2 h 13 min", "45 min", "3 j". */
export function formatCountdown(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${(min % 60).toString().padStart(2, "0")} min`;
  return `${Math.round(h / 24)} j`;
}

const rtf = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto", style: "short" });

/** "à l'instant", "il y a 5 min", "hier"… */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "à l'instant";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fullDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function parseKey(key: string): Date {
  // "YYYY-MM-DD" or "YYYY-MM-DD HH" — local time.
  const [date = "", hour] = key.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour ? Number(hour) : 0);
}

/** Short axis label for a usage bucket key. */
export function bucketLabel(key: string, range: UsageRange): string {
  const date = parseKey(key);
  switch (range) {
    case "day":
      return `${date.getHours().toString().padStart(2, "0")}h`;
    case "week":
      return weekday.format(date).replace(".", "");
    case "month":
      return dayMonth.format(date).replace(".", "");
  }
}

/** Long label for tooltips. */
export function bucketTitle(key: string, range: UsageRange): string {
  const date = parseKey(key);
  if (range === "day") {
    const h = date.getHours();
    return `${h.toString().padStart(2, "0")}:00 – ${((h + 1) % 24).toString().padStart(2, "0")}:00`;
  }
  return fullDay.format(date);
}
