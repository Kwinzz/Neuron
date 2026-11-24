import type { UsageRange } from "@/bindings/UsageRange";
import { getLang, locale, t } from "@/i18n";

/** Formatters of the current language (rebuilt once after a language change). */
function formatters() {
  const lang = getLang();
  if (cache?.lang !== lang) {
    const loc = locale();
    cache = {
      lang,
      compact: new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }),
      integer: new Intl.NumberFormat(loc),
      decimal: new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      usd: new Intl.NumberFormat(loc, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }),
      usdSmall: new Intl.NumberFormat(loc, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 3 }),
      rtf: new Intl.RelativeTimeFormat(loc, { numeric: "auto", style: "short" }),
      weekday: new Intl.DateTimeFormat(loc, { weekday: "short" }),
      dayMonth: new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }),
      fullDay: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }),
    };
  }
  return cache;
}
let cache: {
  lang: string;
  compact: Intl.NumberFormat;
  integer: Intl.NumberFormat;
  decimal: Intl.NumberFormat;
  usd: Intl.NumberFormat;
  usdSmall: Intl.NumberFormat;
  rtf: Intl.RelativeTimeFormat;
  weekday: Intl.DateTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  fullDay: Intl.DateTimeFormat;
} | null = null;

/** 1234 → "1,2 k", 2_400_000 → "2,4 M". */
export function formatTokens(n: number): string {
  const f = formatters();
  return Math.abs(n) < 1000 ? f.integer.format(n) : f.compact.format(n);
}

export function formatInteger(n: number): string {
  return formatters().integer.format(n);
}

export function formatCost(n: number): string {
  const f = formatters();
  if (n === 0) return f.usd.format(0);
  return n < 1 ? f.usdSmall.format(n) : f.usd.format(n);
}

export function formatPercent(ratio: number): string {
  // French puts a space before the percent sign.
  return getLang() === "fr" ? `${Math.round(ratio * 100)} %` : `${Math.round(ratio * 100)}%`;
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

/** Duration of a request: "0,8 s", "12,4 s", "1 min 05 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return `${formatters().decimal.format(safe / 1000)} s`;
  const total = Math.round(safe / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min ${s.toString().padStart(2, "0")} s`;
}

/** Remaining time: "2 h 13 min", "45 min", "3 j". */
export function formatCountdown(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${(min % 60).toString().padStart(2, "0")} min`;
  return `${Math.round(h / 24)} ${getLang() === "fr" ? "j" : "d"}`;
}

/** "à l'instant", "il y a 5 min", "hier"… (or English). */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const { rtf } = formatters();
  if (abs < 45_000) return t("common.justNow");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}


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
      return getLang() === "fr" ? `${date.getHours().toString().padStart(2, "0")}h` : `${date.getHours()}:00`;
    case "week":
      return formatters().weekday.format(date).replace(".", "");
    case "month":
      return formatters().dayMonth.format(date).replace(".", "");
  }
}

/** Long label for tooltips. */
export function bucketTitle(key: string, range: UsageRange): string {
  const date = parseKey(key);
  if (range === "day") {
    const h = date.getHours();
    return `${h.toString().padStart(2, "0")}:00 – ${((h + 1) % 24).toString().padStart(2, "0")}:00`;
  }
  return formatters().fullDay.format(date);
}
