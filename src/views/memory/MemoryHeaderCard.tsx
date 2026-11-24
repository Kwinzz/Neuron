import { useState } from "react";
import { cn } from "cn";
import { Brain, Download, FileText, FolderOpen, Loader2, Plus } from "lucide-react";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import type { MemoryInfo } from "@/bindings/MemoryInfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";

interface MemoryHeaderCardProps {
  info: MemoryInfo | null;
  counts: Record<MemoryCategory, number>;
  total: number;
  onNew: () => void;
  /** Open the « Importer une mémoire » dialog. */
  onImport: () => void;
  /** Jump to a category card (the view clears an active search first). */
  onJumpToCategory: (category: MemoryCategory) => void;
}

export function MemoryHeaderCard({
  info,
  counts,
  total,
  onNew,
  onImport,
  onJumpToCategory,
}: MemoryHeaderCardProps) {
  const [openingFile, setOpeningFile] = useState(false);

  const handleOpenFile = async () => {
    if (openingFile) return;
    setOpeningFile(true);
    try {
      await ipc.openMemoryFile();
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible d'ouvrir memory.md",
        description: ipcErrorMessage(err),
      });
    } finally {
      setOpeningFile(false);
    }
  };

  const visibleBadgeCategories = CATEGORY_ORDER.filter(
    (category) => category !== "other" || counts.other > 0,
  );

  return (
    <Card className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Brain className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>Mémoire globale</span>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {total}
            </Badge>
          </CardTitle>
          <CardDescription>
            Partagée par tous tes agents : injectée au début de chaque nouveau chat et
            accessible en direct via le serveur MCP de Neuron.
          </CardDescription>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={openingFile}
            onClick={() => void handleOpenFile()}
          >
            {openingFile ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <FileText aria-hidden />
            )}
            <span>Ouvrir memory.md</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onImport}>
            <Download aria-hidden />
            <span>Importer</span>
          </Button>
          <Button type="button" size="sm" onClick={onNew}>
            <Plus aria-hidden />
            <span>Nouveau souvenir</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {info ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="min-w-0 truncate rounded-sm font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {info.filePath}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-md font-mono wrap-anywhere">
                {info.filePath}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Skeleton className="h-4 w-64 max-w-full" />
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {visibleBadgeCategories.map((category) => {
            const meta = CATEGORIES[category];
            const Icon = meta.icon;
            const count = counts[category];
            return (
              <Badge key={category} variant="outline" asChild>
                <button
                  type="button"
                  onClick={() => onJumpToCategory(category)}
                  className={cn(
                    "cursor-pointer gap-1.5 transition-colors duration-150 hover:bg-accent hover:text-foreground",
                    count === 0 && "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "shrink-0",
                      count === 0 ? "text-muted-foreground" : meta.iconClass,
                    )}
                    aria-hidden
                  />
                  <span>{meta.short}</span>
                  <span className="font-mono tabular-nums">{count}</span>
                </button>
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
