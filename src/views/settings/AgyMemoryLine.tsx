import { useEffect, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

/**
 * Antigravity ⇄ Neuron memory: agy takes no MCP server per session, so Neuron registers it once in agy's
 * config (`agy mcp add neuron`) — on the user's request only.
 */
export function AgyMemoryLine() {
  const agy = useMemory((s) => s.agy);
  const [pending, setPending] = useState<"connect" | "disconnect" | null>(null);

  useEffect(() => {
    void useMemory
      .getState()
      .refreshAgy()
      .catch(() => undefined);
  }, []);

  const run = async (action: "connect" | "disconnect") => {
    if (pending !== null) return;
    setPending(action);
    try {
      if (action === "connect") {
        await useMemory.getState().connectAgy();
        toast({ tone: "ok", title: t("settings.agyConnected") });
      } else {
        await useMemory.getState().disconnectAgy();
        toast({ tone: "ok", title: t("settings.agyDisconnected") });
      }
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title:
          action === "connect"
            ? t("settings.agyConnectFailed")
            : t("settings.agyDisconnectFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setPending(null);
    }
  };

  if (agy === null) return <Skeleton className="h-5 w-40" />;
  if (agy === "unavailable") return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {agy === "connected" ? (
        <>
          <span className="inline-flex items-center gap-1">
            <Check className="size-3.5 shrink-0 text-ok" aria-hidden />
            <span>{t("settings.memoryLinked")}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pending !== null}
            onClick={() => void run("disconnect")}
          >
            {pending === "disconnect" && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            )}
            <span>{t("settings.unplug")}</span>
          </Button>
        </>
      ) : (
        <>
          {agy === "outdated" ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              <span>{t("settings.memoryOutdated")}</span>
            </span>
          ) : (
            <span title={t("settings.agyMcpHint")}>{t("settings.memoryNotLinked")}</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pending !== null}
            onClick={() => void run("connect")}
          >
            {pending === "connect" && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            )}
            <span>
              {agy === "outdated" ? t("settings.replug") : t("settings.plugMemory")}
            </span>
          </Button>
        </>
      )}
    </div>
  );
}
