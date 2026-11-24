import { useEffect, useState } from "react";
import { CircleDollarSign, RefreshCw } from "lucide-react";
import type { PricingStatus } from "@/bindings/PricingStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

/** Where model prices come from (LiteLLM list, refreshed daily) + manual refresh. */
export function PricingCard() {
  const [status, setStatus] = useState<PricingStatus | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void ipc.pricingStatus().then(setStatus).catch(() => undefined);
  }, []);

  const refresh = async () => {
    setPending(true);
    try {
      const next = await ipc.refreshPrices();
      setStatus(next);
      toast({
        tone: "ok",
        title: t("settings.pricingUpdated"),
        description: t("settings.pricingModels", { n: next.modelCount }),
      });
    } catch (err) {
      toast({ tone: "danger", title: t("settings.pricingFailed"), description: ipcErrorMessage(err) });
      void ipc.pricingStatus().then(setStatus).catch(() => undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <CircleDollarSign className="size-4 text-muted-foreground" />
          {t("settings.pricingTitle")}
        </CardTitle>
        <CardDescription>
          {t("settings.pricingDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {status === null ? (
            "…"
          ) : status.source === "litellm" && status.fetchedAt !== null ? (
            <>
              <span className="tabular-nums text-foreground">{status.modelCount}</span>{" "}
              {t("settings.pricingModelsUpdated")}{" "}
              {formatRelative(status.fetchedAt)}
            </>
          ) : (
            t("settings.pricingBuiltin")
          )}
          {status?.error && <span className="mt-1 block text-warn">{t("settings.pricingLastError", { error: status.error })}</span>}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={pending || !isTauri()}>
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          {t("settings.refresh")}
        </Button>
      </CardContent>
    </Card>
  );
}
