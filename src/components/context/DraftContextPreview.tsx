import { useEffect, useState } from "react";
import { Clock, Eye, Layers, Pencil } from "lucide-react";
import type { ContextBundle } from "@/bindings/ContextBundle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useUi } from "@/stores/ui";
import { ContextBundleView } from "./ContextBundleView";
import { SourceList } from "./SourceList";

interface DraftContextPreviewProps {
  projectId: string;
}

type PreviewState =
  | { projectId: string; status: "ok"; bundle: ContextBundle }
  | { projectId: string; status: "error" };

export function DraftContextPreview({ projectId }: DraftContextPreviewProps) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    let cancelled = false;

    ipc
      .projectOverview(projectId)
      .then((overview) => {
        if (!cancelled) {
          setState({ projectId, status: "ok", bundle: overview.preview });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ projectId, status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!state || state.projectId !== projectId) {
    return <Skeleton className="h-8 w-full max-w-xl rounded-lg" />;
  }

  if (state.status === "error") {
    return <p className="text-xs text-muted-foreground">{t("project.ctxUnavailable")}</p>;
  }

  const { bundle } = state;

  const handleEdit = () => {
    setOpen(false);
    useUi.getState().openProject(projectId, "context");
  };

  return (
    <div className="flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-xs animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Layers className="size-3.5 shrink-0" aria-hidden />
        <span>{t("project.ctxInjectedAtStart")}</span>
      </span>

      {bundle.sources.length > 0 ? (
        <SourceList sources={bundle.sources} />
      ) : (
        <span className="text-muted-foreground">{t("project.ctxNoSourceLower")}</span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs">
              <Eye aria-hidden />
              <span>{t("project.ctxView")}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[460px] max-w-[calc(100vw-2rem)] gap-0 p-0">
            <PopoverHeader className="border-b p-3">
              <PopoverTitle>{t("project.ctxPreviewTitle")}</PopoverTitle>
              <PopoverDescription className="flex items-center gap-1.5 text-xs">
                <Clock className="size-3 shrink-0" aria-hidden />
                <span>{t("project.ctxPreviewFrozen")}</span>
              </PopoverDescription>
            </PopoverHeader>

            <div className="min-w-0 p-3">
              <ContextBundleView bundle={bundle} size="xs" className="max-h-80" />
            </div>

            <div className="flex justify-end border-t p-2">
              <Button variant="ghost" size="sm" onClick={handleEdit}>
                <Pencil aria-hidden />
                <span>{t("project.ctxEdit")}</span>
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => useUi.getState().openProject(projectId, "context")}
        >
          <Pencil aria-hidden />
          <span>{t("common.edit")}</span>
        </Button>
      </div>
    </div>
  );
}
