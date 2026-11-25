import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEffect } from "react";
import type { ProviderUsage } from "@/bindings/ProviderUsage";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { QuotaRow } from "./QuotaRow";

interface QuotasCardProps {
  className?: string;
}

/** Earliest reset still to come among the provider-reported windows. */
function nextReset(providers: ProviderUsage[], now: number): number | null {
  let next: number | null = null;
  for (const p of providers) {
    for (const q of [p.live, ...p.groups]) {
      const at = q?.resetsAt;
      if (at != null && at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

export function QuotasCard({ className }: QuotasCardProps) {
  const providers = useDashboard((s) => s.snapshot?.providers);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !providers;

  // Home shown: fresh quotas from the agents (Antigravity /quota, Codex / Claude logs), not the last report.
  useEffect(() => {
    void ipc.refreshQuotas().catch(() => undefined);
  }, []);

  // A window that resets starts over: reload then, instead of showing its old utilization.
  useEffect(() => {
    if (!providers) return;
    const at = nextReset(providers, Date.now());
    if (at === null) return;
    // setTimeout's limit is ~24.8 days; a later reset is caught by another reload before then.
    const delay = Math.min(at - Date.now() + 1_000, 2 ** 31 - 1);
    const timer = setTimeout(() => void useDashboard.getState().load(), delay);
    return () => clearTimeout(timer);
  }, [providers]);

  const count = providers?.length ?? 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("home.quotasTitle")}</CardTitle>
        {!isLoading && (
          <CardDescription>
            {t("home.providerCount", { n: count })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col divide-y">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-1 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : !providers || providers.length === 0 ? (
          <p className="text-sm text-muted-foreground animate-in fade-in-0 duration-300">{t("home.quotasEmpty")}</p>
        ) : (
          <div className="flex flex-col divide-y animate-in fade-in-0 duration-300">
            {providers.map((usage) => (
              <QuotaRow key={usage.provider.id} usage={usage} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
