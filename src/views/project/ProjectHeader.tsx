import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { FolderOpen, GitBranch, MessageSquare, Pencil, Plus, RefreshCw } from "lucide-react";
import type { ProjectOverview } from "@/bindings/ProjectOverview";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { deviceOfProject } from "@/lib/deviceRouting";
import { openFolder } from "@/lib/openFolder";
import { renameProject } from "@/lib/projectActions";
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
  const device = deviceOfProject(projectId);
  const git = overview?.git ?? null;
  const changedCount = git?.changed.length ?? 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    setEditing(false);
  }, [projectId]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!project) return;
    settledRef.current = false;
    setDraft(project.name);
    setEditing(true);
  };

  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === project?.name) return;
    await renameProject(projectId, trimmed);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      settledRef.current = true;
      setEditing(false);
    }
  };

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardContent className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
                <div className="flex min-w-0 items-center gap-2">
                  {editing ? (
                    <Input
                      ref={inputRef}
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onInputKeyDown}
                      onBlur={() => void commit()}
                      aria-label={t("project.projectName")}
                      className="h-7 max-w-md rounded-md bg-transparent px-1.5 text-lg font-semibold md:text-lg dark:bg-transparent"
                    />
                  ) : project ? (
                    <h1 className="min-w-0 truncate text-lg leading-tight font-semibold text-foreground">
                      <button
                        type="button"
                        title={t("project.rename")}
                        onClick={startEdit}
                        className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="truncate">{name ?? t("shell.project")}</span>
                        <Pencil
                          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-hidden
                        />
                      </button>
                    </h1>
                  ) : (
                    <h1 className="truncate text-lg leading-tight font-semibold text-foreground">
                      {name ?? t("shell.project")}
                    </h1>
                  )}
                  <DeviceBadge device={device} />
                </div>
                {path && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="block min-w-0 max-w-full truncate rounded-sm font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {path}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md font-mono wrap-anywhere">
                      {path}
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              {git ? (
                <>
                  <Badge variant="outline" className="max-w-52 min-w-0 gap-1.5">
                    <GitBranch className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono">{git.branch ?? t("project.detachedHead")}</span>
                  </Badge>
                  {changedCount > 0 && (
                    <Badge variant="outline" className="gap-1.5 text-warn">
                      <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                      <span className="font-mono tabular-nums">{changedCount}</span>
                      <span>{t("project.changedWord", { n: changedCount })}</span>
                    </Badge>
                  )}
                </>
              ) : (
                !loadingOverview &&
                overview !== null && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("project.noRepo")}
                  </Badge>
                )
              )}

              {project && (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  <MessageSquare className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-mono tabular-nums text-foreground">
                    {project.threadCount}
                  </span>
                  <span>{t("project.chatWord", { n: project.threadCount })}</span>
                  {project.activeCount > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono tabular-nums text-live">
                        {t("project.activeCount", { n: project.activeCount })}
                      </span>
                    </>
                  )}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {path && !device && (
            <Button variant="outline" size="sm" onClick={() => void openFolder(path)}>
              <FolderOpen aria-hidden />
              <span>{t("common.openFolder")}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || loadingOverview}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            <span>{t("project.refresh")}</span>
          </Button>
          <Button size="sm" onClick={() => useUi.getState().startChat(projectId)}>
            <Plus aria-hidden />
            <span>{t("shell.navNewChat")}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
