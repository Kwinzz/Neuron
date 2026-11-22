import { Card } from "@/components/ui/Card";
import { RingGauge } from "@/components/ui/RingGauge";
import { formatPercent, formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { RANGE_LABEL } from "./rangeLabel";

export function CacheCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const cacheRead = usage?.totals.cacheRead ?? 0;
  const cacheWrite = usage?.totals.cacheWrite ?? 0;
  const input = usage?.totals.input ?? 0;
  const denom = cacheRead + input;
  const hit = denom > 0 ? cacheRead / denom : 0;

  return (
    <Card title="Efficacité du cache" subtitle={RANGE_LABEL[range]}>
      <div className="flex flex-1 flex-col items-center gap-[18px] sm:flex-row">
        <div className="flex w-full flex-1 flex-col gap-[18px]">
          <Card variant="tile" as="div">
            <p className="text-xs font-bold text-fg-muted">Cache lu</p>
            {isLoading ? (
              <Placeholder className="mt-1.5 h-5 w-20" />
            ) : (
              <p className="mt-1 text-lg font-bold tabular-nums text-fg">
                {usage ? formatTokens(cacheRead) : "—"}
              </p>
            )}
          </Card>

          <Card variant="tile" as="div">
            <p className="text-xs font-bold text-fg-muted">Cache écrit</p>
            {isLoading ? (
              <Placeholder className="mt-1.5 h-5 w-20" />
            ) : (
              <p className="mt-1 text-lg font-bold tabular-nums text-fg">
                {usage ? formatTokens(cacheWrite) : "—"}
              </p>
            )}
          </Card>
        </div>

        <RingGauge
          size={160}
          thickness={8}
          sweep={360}
          color="var(--color-accent-2)"
          value={isLoading ? 0 : hit}
          label="Taux de lecture cache"
        >
          <span className="text-xs text-fg-muted">Taux</span>
          {isLoading ? (
            <Placeholder className="my-1 h-7 w-16" />
          ) : (
            <span className="text-[28px] font-bold leading-tight tabular-nums text-fg">
              {denom > 0 ? formatPercent(hit) : "—"}
            </span>
          )}
          <span className="text-xs text-fg-muted">de lecture cache</span>
        </RingGauge>
      </div>
    </Card>
  );
}
