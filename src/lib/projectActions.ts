/**
 * Project mutations shared by the sidebar project menu and project page header.
 * Optimistically updates nav and live stores, then reloads nav & dashboard to stay in sync.
 */
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";

function setOptimisticProjectName(projectId: string, name: string): void {
  useNav.setState((s) => {
    let projectsChanged = false;
    const projects = s.projects.map((p) => {
      if (p.id !== projectId || p.name === name) return p;
      projectsChanged = true;
      return { ...p, name };
    });
    let chatsChanged = false;
    const chats = s.chats.map((c) => {
      if (c.projectId !== projectId || c.projectName === name) return c;
      chatsChanged = true;
      return { ...c, projectName: name };
    });
    if (!projectsChanged && !chatsChanged) return s;
    return {
      ...(projectsChanged ? { projects } : {}),
      ...(chatsChanged ? { chats } : {}),
    };
  });

  useLive.setState((s) => {
    let threads: typeof s.threads | null = null;
    for (const [id, th] of Object.entries(s.threads)) {
      if (th.projectId === projectId && th.projectName !== name) {
        threads ??= { ...s.threads };
        threads[id] = { ...th, projectName: name };
      }
    }
    return threads ? { threads } : s;
  });
}

/** Rename a project (optimistic, with rollback + toast on error). Returns true on success. */
export async function renameProject(projectId: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const previous = useNav.getState().projects.find((p) => p.id === projectId)?.name ?? "";
  if (trimmed === previous) return true;

  setOptimisticProjectName(projectId, trimmed);
  try {
    await ipc.renameProject(projectId, trimmed);
    await useNav.getState().load();
    void useDashboard.getState().load();
    return true;
  } catch (err) {
    if (previous) setOptimisticProjectName(projectId, previous);
    toast({
      tone: "danger",
      title: t("project.renameFailed"),
      description: ipcErrorMessage(err),
    });
    return false;
  }
}
