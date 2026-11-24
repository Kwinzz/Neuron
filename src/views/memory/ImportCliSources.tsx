import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { LocalMemorySource } from "@/bindings/LocalMemorySource";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { formatFileSize } from "./importOrigins";
import { ImportOriginLogo } from "./ImportOriginLogo";
import { t } from "@/i18n";

interface ImportCliSourcesProps {
  /** A file was read: fill the text area with it. */
  onUse: (origin: MemoryImportOrigin, content: string) => void;
}

/** Instruction files of the agent CLIs found on this computer. Loaded each time the tab is opened. */
export function ImportCliSources({ onUse }: ImportCliSourcesProps) {
  const [sources, setSources] = useState<LocalMemorySource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readingPath, setReadingPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSources(await ipc.memoryImportSources());
    } catch (err: unknown) {
      setError(ipcErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUse = async (source: LocalMemorySource) => {
    if (readingPath !== null) return;
    setReadingPath(source.path);
    try {
      const content = await ipc.readMemoryImportFile(source.path);
      onUse(source.origin, content);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("memory.readFileOfFailed", { label: source.label }),
        description: ipcErrorMessage(err),
      });
    } finally {
      setReadingPath(null);
    }
  };

  if (error !== null) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>{t("memory.filesNotFound")}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button type="button" size="xs" variant="outline" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("memory.cliSourcesIntro")}
      </p>
      <ul className="flex min-w-0 flex-col divide-y rounded-lg border">
        {sources === null
          ? [0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="size-4 rounded-sm" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
              </li>
            ))
          : sources.map((source) => (
              <li key={source.path} className="flex min-w-0 items-center gap-3 p-3">
                <ImportOriginLogo origin={source.origin} size={16} className="shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {source.label}
                    {source.exists && (
                      <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
                        {formatFileSize(source.bytes)}
                      </span>
                    )}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground" title={source.path}>
                    {source.path}
                  </span>
                </div>
                {source.exists ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readingPath !== null || source.bytes === 0}
                    onClick={() => void handleUse(source)}
                  >
                    {source.bytes === 0 ? t("memory.fileEmpty") : t("memory.useFile")}
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("memory.fileMissing")}
                  </Badge>
                )}
              </li>
            ))}
      </ul>
    </div>
  );
}
