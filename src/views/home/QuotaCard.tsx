import { AlertTriangle, Settings2 } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import type { ProviderUsage } from "@/bindings/ProviderUsage";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { formatPercent } from "@/lib/format";
import { QuotaEditor } from "./QuotaEditor";
import { ResetCountdown } from "./ResetCountdown";
import { formatQuotaValue, WINDOW_LABEL } from "./quotaFormat";

interface QuotaCardProps {
  usage: ProviderUsage;
}

export const QuotaCard = memo(function QuotaCard({ usage }: QuotaCardProps) {
  const [editing, setEditing] = useState(false);
  const settingsRef = useRef<HTMLButtonElement | null>(null);

  // When the editor unmounts with focus inside it (Esc, Annuler, save), hand focus back to its trigger.
  const closeEditor = useCallback(() => {
    setEditing(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) settingsRef.current?.focus();
    });
  }, []);
  const { provider, used, ratio, resetsAt } = usage;

  const isExceeded = ratio != null && ratio >= 1;
  const isWarning = ratio != null && ratio >= provider.alertPct && ratio < 1;

  const barColor = isExceeded ? "bg-danger" : isWarning ? "bg-warn" : "bg-ok";
  const alertTextColor = isExceeded ? "text-danger" : "text-warn";

  return (
    <div className="relative flex flex-col justify-between gap-2.5 rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <AgentBadge agent={provider.agent} variant="dot" />
            <span className="truncate font-medium text-fg">{provider.label}</span>
          </div>
          {provider.plan && (
            <span className="truncate pl-3 text-xs text-fg-subtle" title={provider.plan}>
              {provider.plan}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {WINDOW_LABEL[provider.windowKind]}
          </span>
          <button
            ref={settingsRef}
            type="button"
            aria-label="Configurer le quota"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
            className="rounded-sm p-1 text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg"
          >
            <Settings2 size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate">
          <span className="font-mono text-xl tabular-nums text-fg">
            {formatQuotaValue(used, provider.unit)}
          </span>
          {provider.limitValue != null && (
            <span className="font-mono text-xs tabular-nums text-fg-subtle">
              {" "}
              / {formatQuotaValue(provider.limitValue, provider.unit)}
            </span>
          )}
        </div>

        {ratio != null && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
            {formatPercent(ratio)}
          </span>
        )}
      </div>

      {ratio != null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-hover">
          <div
            className={`h-full w-full origin-left rounded-full ${barColor} transition-transform duration-fast`}
            style={{ transform: `scaleX(${Math.min(Math.max(ratio, 0), 1)})` }}
          />
        </div>
      )}

      <div className="flex min-h-[16px] flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {ratio != null && ratio >= provider.alertPct ? (
          <span className={`inline-flex items-center gap-1 text-[11px] ${alertTextColor}`}>
            <AlertTriangle size={12} strokeWidth={1.75} className="shrink-0" />
            <span>{isExceeded ? "Quota dépassé" : "Seuil d'alerte atteint"}</span>
          </span>
        ) : provider.limitValue == null ? (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-fg-subtle">Aucune limite définie</span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-accent transition-colors duration-fast hover:text-accent-strong"
            >
              Configurer
            </button>
          </div>
        ) : (
          <span />
        )}

        {resetsAt != null && <ResetCountdown resetsAt={resetsAt} />}
      </div>

      {editing && <QuotaEditor provider={provider} onClose={closeEditor} anchorRef={settingsRef} />}
    </div>
  );
});
