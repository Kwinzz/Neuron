import { AlertTriangle, Gauge } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconBox } from "@/components/ui/IconBox";
import { RingGauge } from "@/components/ui/RingGauge";
import { formatPercent } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { QuotaEditor } from "./QuotaEditor";
import {
  effectiveRatio,
  effectiveResetsAt,
  formatQuotaValue,
  LEVEL_COLOR,
  LEVEL_TEXT,
  pickTopProvider,
  quotaLevel,
  WINDOW_LABEL,
} from "./quotaFormat";
import { ResetCountdown } from "./ResetCountdown";

export function TopQuotaCard() {
  const providers = useDashboard((s) => s.snapshot?.providers);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !providers;

  const top = useMemo(() => pickTopProvider(providers), [providers]);

  const [editing, setEditing] = useState(false);
  const configBtnRef = useRef<HTMLButtonElement | null>(null);

  const closeEditor = useCallback(() => {
    setEditing(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) configBtnRef.current?.focus();
    });
  }, []);

  if (isLoading) {
    return (
      <Card title="Quota le plus sollicité">
        <div className="flex flex-1 flex-col items-center justify-center">
          <RingGauge sweep={240} size={180} thickness={8} value={0} label="Chargement du quota">
            <IconBox size={45} tone="muted" className="rounded-full">
              <Gauge size={22} />
            </IconBox>
          </RingGauge>
          <div className="glass-tile relative -mt-8 flex w-full max-w-[260px] items-center justify-between rounded-xl px-5 py-3">
            <Placeholder className="h-12 w-full" />
          </div>
        </div>
      </Card>
    );
  }

  if (!top) {
    return (
      <Card title="Quota le plus sollicité">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <IconBox size={45} tone="muted" className="rounded-full">
            <Gauge size={22} />
          </IconBox>
          <p className="text-sm font-bold text-fg">Aucun fournisseur configuré</p>
          <p className="text-xs text-fg-muted">Les quotas apparaîtront ici.</p>
        </div>
      </Card>
    );
  }

  const { provider, used, live } = top;
  const ratio = effectiveRatio(top);
  const resetsAt = effectiveResetsAt(top);
  const level = quotaLevel(ratio, provider.alertPct);
  const isAlert = level === "warn" || level === "danger";
  const iconTone =
    level === "danger"
      ? "danger"
      : level === "warn"
        ? "warn"
        : ratio == null
          ? "muted"
          : "brand";

  return (
    <Card
      title="Quota le plus sollicité"
      subtitle={`${provider.label} · ${WINDOW_LABEL[provider.windowKind]}`}
    >
      <div className="relative flex flex-1 flex-col items-center justify-center">
        <RingGauge
          sweep={240}
          size={180}
          thickness={8}
          value={ratio ?? 0}
          color={LEVEL_COLOR[level]}
          label={`Quota ${provider.label}`}
        >
          <IconBox size={45} tone={iconTone} className="rounded-full">
            {isAlert ? <AlertTriangle size={22} /> : <Gauge size={22} />}
          </IconBox>
        </RingGauge>

        <div className="glass-tile relative -mt-8 flex w-full max-w-[260px] items-center justify-between rounded-xl px-5 py-3">
          {ratio != null && (live || provider.limitValue != null) ? (
            <>
              <span className="text-xs text-fg-muted">0 %</span>
              <div className="flex flex-col items-center text-center">
                <span className="text-[28px] font-bold leading-tight tabular-nums text-fg">
                  {formatPercent(ratio)}
                </span>
                <span className="mt-0.5 text-xs tabular-nums text-fg-muted">
                  {live || provider.limitValue == null
                    ? "abonnement Claude"
                    : `${formatQuotaValue(used, provider.unit)} / ${formatQuotaValue(provider.limitValue, provider.unit)}`}
                </span>
              </div>
              <span className="text-xs text-fg-muted">100 %</span>
            </>
          ) : (
            <div className="flex w-full flex-col items-center text-center">
              <span className="text-sm font-bold text-fg">Aucune limite</span>
              <span className="mt-0.5 text-xs tabular-nums text-fg-muted">
                {formatQuotaValue(used, provider.unit)} consommé
              </span>
            </div>
          )}
        </div>

        {isAlert && (
          <p className={`mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold ${LEVEL_TEXT[level]}`}>
            <AlertTriangle size={14} className="shrink-0" />
            <span>{level === "danger" ? "Quota dépassé" : "Seuil d'alerte atteint"}</span>
          </p>
        )}

        {ratio == null && (
          <div className="mt-3">
            <Button
              ref={configBtnRef}
              size="sm"
              variant="brand"
              aria-expanded={editing}
              onClick={() => setEditing((v) => !v)}
            >
              Configurer
            </Button>
          </div>
        )}

        {resetsAt != null && (
          <div className="mt-2">
            <ResetCountdown resetsAt={resetsAt} />
          </div>
        )}

        {editing && (
          <QuotaEditor provider={provider} onClose={closeEditor} anchorRef={configBtnRef} />
        )}
      </div>
    </Card>
  );
}
