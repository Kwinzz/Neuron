import { AlertTriangle, Settings2 } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import type { ProviderUsage } from "@/bindings/ProviderUsage";
import { IconBox } from "@/components/ui/IconBox";
import { Progress } from "@/components/ui/Progress";
import { AGENTS } from "@/lib/agents";
import { formatPercent } from "@/lib/format";
import { QuotaEditor } from "./QuotaEditor";
import {
  formatQuotaValue,
  LEVEL_FILL,
  LEVEL_TEXT,
  quotaLevel,
  WINDOW_LABEL,
} from "./quotaFormat";
import { ResetCountdown } from "./ResetCountdown";

interface QuotaRowProps {
  usage: ProviderUsage;
}

export const QuotaRow = memo(function QuotaRow({ usage }: QuotaRowProps) {
  const [editing, setEditing] = useState(false);
  const settingsRef = useRef<HTMLButtonElement | null>(null);

  const closeEditor = useCallback(() => {
    setEditing(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) settingsRef.current?.focus();
    });
  }, []);

  const { provider, used, ratio, resetsAt } = usage;
  const level = quotaLevel(ratio, provider.alertPct);
  const isAlert = level === "warn" || level === "danger";
  const sub = [provider.plan, WINDOW_LABEL[provider.windowKind]].filter(Boolean).join(" · ");

  return (
    <div className="relative border-b border-line-chart/60 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-3">
        <IconBox size={30} tone="muted">
          <span className={`size-2.5 rounded-[3px] ${AGENTS[provider.agent].bg}`} />
        </IconBox>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-fg">{provider.label}</p>
          <p className="truncate text-xs text-fg-muted">{sub}</p>
        </div>

        <div className="shrink-0 text-right text-sm font-bold tabular-nums text-fg">
          {formatQuotaValue(used, provider.unit)}
          {provider.limitValue != null && (
            <span className="font-normal text-fg-muted">
              {" "}
              / {formatQuotaValue(provider.limitValue, provider.unit)}
            </span>
          )}
        </div>

        <button
          ref={settingsRef}
          type="button"
          aria-label={`Configurer ${provider.label}`}
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-fast hover:bg-surface hover:text-fg"
        >
          <Settings2 size={16} />
        </button>
      </div>

      {ratio != null && (
        <Progress
          className="mt-3"
          value={ratio}
          fillClassName={LEVEL_FILL[level]}
          label={`Quota ${provider.label}`}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        {isAlert ? (
          <span className={`inline-flex items-center gap-1 font-bold ${LEVEL_TEXT[level]}`}>
            <AlertTriangle size={12} className="shrink-0" />
            <span>{level === "danger" ? "Quota dépassé" : "Seuil d'alerte atteint"}</span>
          </span>
        ) : provider.limitValue == null ? (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <span>Aucune limite définie ·</span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="font-bold text-accent transition-colors duration-fast hover:text-accent-strong"
            >
              Configurer
            </button>
          </span>
        ) : (
          <span />
        )}

        <div className="inline-flex items-center gap-2">
          {resetsAt != null && <ResetCountdown resetsAt={resetsAt} />}
          {ratio != null && (
            <span className="font-bold tabular-nums text-fg">{formatPercent(ratio)}</span>
          )}
        </div>
      </div>

      {editing && (
        <QuotaEditor provider={provider} onClose={closeEditor} anchorRef={settingsRef} />
      )}
    </div>
  );
});
