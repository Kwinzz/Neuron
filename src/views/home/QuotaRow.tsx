import { cn } from "cn";
import { AlertTriangle, Settings2 } from "lucide-react";
import { memo, useState } from "react";
import type { ProviderUsage } from "@/bindings/ProviderUsage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { AGENT_ORDER } from "@/lib/agents";
import { formatPercent } from "@/lib/format";
import { QuotaEditor } from "./QuotaEditor";
import {
  effectiveRatio,
  effectiveResetsAt,
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
  const [open, setOpen] = useState(false);

  const { provider, used, live } = usage;
  const ratio = effectiveRatio(usage);
  const resetsAt = effectiveResetsAt(usage);
  const level = quotaLevel(ratio, provider.alertPct);
  const isAlert = level === "warn" || level === "danger";
  const agentColor = `var(--chart-${AGENT_ORDER.indexOf(provider.agent) + 1})`;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: agentColor }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{provider.label}</span>
            <Badge variant="secondary">{WINDOW_LABEL[provider.windowKind]}</Badge>
          </div>
          {provider.plan && (
            <p className="truncate text-xs text-muted-foreground">{provider.plan}</p>
          )}
        </div>

        <div className="shrink-0 text-right font-mono text-sm font-medium tabular-nums">
          {formatQuotaValue(used, provider.unit)}
          {provider.limitValue != null && (
            <span className="font-normal text-muted-foreground">
              {" "}
              / {formatQuotaValue(provider.limitValue, provider.unit)}
            </span>
          )}
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="active:scale-95"
              aria-label={`Configurer ${provider.label}`}
            >
              <Settings2 className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            {open && <QuotaEditor provider={provider} onDone={() => setOpen(false)} />}
          </PopoverContent>
        </Popover>
      </div>

      {ratio != null && (
        <Progress
          value={Math.min(100, ratio * 100)}
          className={cn("mt-3", LEVEL_FILL[level])}
          aria-label={`Quota ${provider.label}`}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        {isAlert ? (
          <span className={cn("inline-flex items-center gap-1 font-medium animate-in fade-in-0 duration-200", LEVEL_TEXT[level])}>
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>{level === "danger" ? "Quota dépassé" : "Seuil d'alerte atteint"}</span>
          </span>
        ) : live ? (
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground"
            title="Utilisation rapportée par Claude Code"
          >
            <span className="size-1.5 rounded-full bg-live" aria-hidden />
            Abonnement · source Claude
          </span>
        ) : provider.limitValue == null ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span>Aucune limite définie ·</span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => setOpen(true)}
            >
              Configurer
            </Button>
          </span>
        ) : (
          <span />
        )}

        <div className="inline-flex items-center gap-2">
          {resetsAt != null && <ResetCountdown resetsAt={resetsAt} />}
          {ratio != null && (
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatPercent(ratio)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
