import { useEffect, useState } from "react";
import { Clock, Layers, Pencil } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useUi } from "@/stores/ui";
import { ContextBundleView } from "./ContextBundleView";

interface ContextIndicatorProps {
  threadId: string;
  projectId: string | null;
}

interface LoadedContext {
  threadId: string;
  bundle: ContextBundle | null;
}

export function ContextIndicator({ threadId, projectId }: ContextIndicatorProps) {
  const [loaded, setLoaded] = useState<LoadedContext | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    let cancelled = false;

    ipc
      .threadContext(threadId)
      .then((bundle) => {
        if (!cancelled) setLoaded({ threadId, bundle });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ threadId, bundle: null });
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const bundle = loaded?.threadId === threadId ? loaded.bundle : null;
  if (!bundle || (bundle.sources.length === 0 && bundle.markdown.trim().length === 0)) {
    return null;
  }

  const count = bundle.sources.length;

  const handleEdit = () => {
    if (projectId == null) return;
    setOpen(false);
    useUi.getState().openProject(projectId, "context");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("project.ctxIndicatorAria", { n: count })}
              className="animate-in fade-in-0 duration-150"
            >
              <Layers aria-hidden />
              <span>{t("project.ctxButton")}</span>
              <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {count}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("project.ctxTooltip")}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-[460px] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <PopoverHeader className="border-b p-3">
          <PopoverTitle>{t("project.ctxTitle")}</PopoverTitle>
          <PopoverDescription className="flex items-center gap-1.5 text-xs">
            <Clock className="size-3 shrink-0" aria-hidden />
            <span>{t("project.ctxFrozen")}</span>
          </PopoverDescription>
        </PopoverHeader>

        <div className="min-w-0 p-3">
          <ContextBundleView bundle={bundle} size="xs" className="max-h-80" />
        </div>

        {projectId != null && (
          <div className="flex justify-end border-t p-2">
            <Button variant="ghost" size="sm" onClick={handleEdit}>
              <Pencil aria-hidden />
              <span>{t("project.ctxEdit")}</span>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
