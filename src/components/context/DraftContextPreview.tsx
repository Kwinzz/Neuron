import { useEffect, useState } from "react";
import { Eye, Layers, Pencil } from "lucide-react";
import type { ContextBundle } from "@/bindings/ContextBundle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ipc } from "@/lib/ipc";
import { useUi } from "@/stores/ui";
import { ContextMarkdown } from "./ContextMarkdown";
import { SourceBadge } from "./SourceBadge";
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
    return <p className="text-xs text-muted-foreground">Contexte indisponible</p>;
  }

  const { bundle } = state;

  return (
    <div className="flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-lg border bg-card/50 px-3 py-2 text-left text-xs animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Layers className="size-3.5 shrink-0" aria-hidden />
        <span>Contexte injecté au démarrage</span>
      </span>

      {bundle.sources.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {bundle.sources.map((source, index) => (
            <SourceBadge key={`${source.kind}-${source.label}-${index}`} source={source} />
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">aucune source</span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs">
              <Eye aria-hidden />
              <span>Voir</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[460px] max-w-[calc(100vw-2rem)] gap-3 p-3">
            <PopoverHeader>
              <PopoverTitle>Ce que recevra le chat</PopoverTitle>
            </PopoverHeader>
            <SourceList sources={bundle.sources} />
            <ContextMarkdown markdown={bundle.markdown} size="xs" className="max-h-80" />
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => useUi.getState().openProject(projectId, "context")}
        >
          <Pencil aria-hidden />
          <span>Modifier</span>
        </Button>
      </div>
    </div>
  );
}
