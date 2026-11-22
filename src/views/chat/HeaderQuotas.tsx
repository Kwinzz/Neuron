import { memo } from "react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import type { LiveWindow } from "@/bindings/LiveWindow";
import { useNow } from "@/hooks/useNow";
import { formatCountdown, formatPercent } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";

const SHORT: Record<string, string> = { five_hour: "5 h", seven_day: "7 j", thirty_day: "30 j" };
const LONG: Record<string, string> = { five_hour: "Quota 5 h", seven_day: "Quota hebdomadaire", thirty_day: "Quota 30 jours" };
/** Shown first, in this order: the 5 h and weekly windows (30 days when the plan only has that one). */
const ORDER = ["five_hour", "seven_day", "thirty_day"];

function tone(utilization: number): string {
  if (utilization >= 0.9) return "bg-destructive";
  if (utilization >= 0.7) return "bg-warn";
  return "bg-ok";
}

const QuotaChip = memo(function QuotaChip({ window: w, now }: { window: LiveWindow; now: number }) {
  const reset = w.resetsAt != null ? ` · reset dans ${formatCountdown(w.resetsAt - now)}` : "";
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground"
      title={`${LONG[w.window] ?? w.window} : ${formatPercent(w.utilization)} utilisé${reset}`}
    >
      <span className="font-sans">{SHORT[w.window] ?? w.window}</span>
      <span className="relative h-1.5 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", tone(w.utilization))}
          style={{ width: `${Math.min(100, w.utilization * 100)}%` }}
        />
      </span>
      <span className="text-foreground">{formatPercent(w.utilization)}</span>
    </span>
  );
});

/**
 * Subscription windows of the chat's provider (Claude: 5 h + weekly; Codex: per plan). Hidden when the
 * provider reports none (Antigravity).
 */
export const HeaderQuotas = memo(function HeaderQuotas({ agent }: { agent: AgentKind }) {
  // `find` returns the store's own object: stable, no re-render loop.
  const quotas = useDashboard((s) => s.snapshot?.liveQuotas.find((q) => q.agent === agent));
  const now = useNow(60_000);
  if (!quotas) return null;
  const shown = ORDER.map((name) => quotas.windows.find((w) => w.window === name)).filter(
    (w): w is LiveWindow => w !== undefined,
  );
  if (shown.length === 0) return null;
  return (
    <span className="hidden items-center gap-3 xl:inline-flex" aria-label="Quotas de l'abonnement">
      {shown.map((w) => (
        <QuotaChip key={w.window} window={w} now={now} />
      ))}
    </span>
  );
});
