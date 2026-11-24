import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { useNav } from "@/stores/nav";
import { useUi } from "@/stores/ui";
import { ContextEditor } from "./ContextEditor";
import { GitCard } from "./GitCard";
import { ProjectChats } from "./ProjectChats";
import { ProjectHeader } from "./ProjectHeader";
import { RecentFilesCard } from "./RecentFilesCard";
import { useProjectData } from "./useProjectData";

type ProjectTab = "context" | "chats";

interface ProjectViewProps {
  projectId: string;
  tab?: ProjectTab;
}

export function ProjectView({ projectId, tab }: ProjectViewProps) {
  const {
    file,
    overview,
    loadingFile,
    loadingOverview,
    refreshing,
    errorFile,
    errorOverview,
    reloadFile,
    reloadOverview,
  } = useProjectData(projectId);

  const projects = useNav((s) => s.projects);
  const chats = useNav((s) => s.chats);
  const navLoaded = useNav((s) => s.loaded);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projects, projectId],
  );

  const localChatCount = useMemo(
    () => chats.filter((chat) => chat.projectId === projectId).length,
    [chats, projectId],
  );

  const [activeTab, setActiveTab] = useState<ProjectTab>(tab ?? "context");

  useEffect(() => {
    setActiveTab(tab ?? "context");
  }, [projectId, tab]);

  const handleRefresh = useCallback(() => {
    reloadOverview();
    void useNav.getState().load();
  }, [reloadOverview]);

  const handleTabChange = (value: string) => {
    if (value === "context" || value === "chats") {
      setActiveTab(value);
    }
  };

  const notFound = navLoaded && !project && !loadingFile && errorFile !== null;

  if (notFound) {
    return (
      <div className="flex min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <Alert
          variant="destructive"
          className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 has-data-[slot=alert-action]:pr-40"
        >
          <AlertCircle aria-hidden />
          <AlertTitle>{t("project.notFound")}</AlertTitle>
          <AlertDescription>{errorFile}</AlertDescription>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={() => useUi.getState().focusThread(null)}>
              {t("project.backHome")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  const chatCount = project?.threadCount ?? localChatCount;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <ProjectHeader
        projectId={projectId}
        project={project}
        fallbackName={file?.projectName}
        overview={overview}
        loadingIdentity={!project && (!navLoaded || loadingFile)}
        loadingOverview={loadingOverview}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="context">{t("project.ctxButton")}</TabsTrigger>
          <TabsTrigger value="chats">
            <span>{t("shell.chats")}</span>
            <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {chatCount}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Kept mounted: an unsaved draft must survive a detour through the Chats tab. */}
        <TabsContent value="context" forceMount className="mt-2 data-[state=inactive]:hidden">
          <div className="grid gap-4 md:gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
            <ContextEditor
              projectId={projectId}
              file={file}
              loading={loadingFile}
              error={errorFile}
              onRetry={reloadFile}
              preview={overview?.preview}
              previewLoading={loadingOverview}
              onSaved={reloadOverview}
            />
            <div className="flex min-w-0 flex-col gap-4 md:gap-6">
              <GitCard git={overview?.git ?? null} loading={loadingOverview} error={errorOverview} />
              <RecentFilesCard
                files={overview?.recentFiles ?? []}
                loading={loadingOverview}
                error={errorOverview}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="chats" className="mt-2">
          <ProjectChats projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
