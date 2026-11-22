import { cn } from "cn";
import { FolderOpen, GitBranch, MessageSquare, Plus, RefreshCw } from "lucide-react";
import type { ProjectOverview } from "@/bindings/ProjectOverview";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUi } from "@/stores/ui";

interface ProjectHeaderProps {
  projectId: string;
  project: ProjectSummary | undefined;
  fallbackName?: string;
  overview: ProjectOverview | null;
  loadingIdentity: boolean;
  loadingOverview: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export function ProjectHeader({
  projectId,
  project,
  fallbackName,
  overview,
  loadingIdentity,
  loadingOverview,
  refreshing,
  onRefresh,
}: ProjectHeaderProps) {
  const name = project?.name ?? fallbackName;
  const path = project?.path;
  const git = overview?.git ?? null;
  const changedCount = git?.changed.length ?? 0;

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FolderOpen className="size-5" aria-hidden />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {loadingIdentity && !name ? (
              <>
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </>
            ) : (
              <>
                <h1 className="truncate text-lg leading-tight font-semibold text-foreground">
                  {name ?? "Projet"}
                </h1>
                {path && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="block max-w-full truncate font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 focus-visible:text-foreground"
                      >
                        {path}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md font-mono wrap-anywhere">{path}</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {git ? (
                <>
                  <Badge variant="outline" className="max-w-52 min-w-0">
                    <GitBranch className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono">{git.branch ?? "HEAD détachée"}</span>
                  </Badge>
                  {changedCount > 0 && (
                    <Badge variant="outline" className="gap-1.5 text-warn">
                      <span className="size-1.5 rounded-full bg-warn" aria-hidden />
                      <span className="font-mono tabular-nums">{changedCount}</span>
                      <span>{changedCount === 1 ? "modifié" : "modifiés"}</span>
                    </Badge>
                  )}
                </>
              ) : (
                !loadingOverview &&
                overview !== null && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Pas de dépôt git
                  </Badge>
                )
              )}

              {project && (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  <MessageSquare aria-hidden />
                  <span className="font-mono tabular-nums text-foreground">{project.threadCount}</span>
                  <span>{project.threadCount <= 1 ? "chat" : "chats"}</span>
                  {project.activeCount > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono tabular-nums text-live">
                        {project.activeCount} {project.activeCount === 1 ? "actif" : "actifs"}
                      </span>
                    </>
                  )}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || loadingOverview}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            <span>Actualiser</span>
          </Button>
          <Button size="sm" onClick={() => useUi.getState().startChat(projectId)}>
            <Plus aria-hidden />
            <span>Nouveau chat</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
