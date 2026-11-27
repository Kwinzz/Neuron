/**
 * Project removal, asked from the sidebar (or elsewhere) and confirmed in one dialog (`RemoveProjectDialog`,
 * mounted once in AppShell). Removing a project detaches its chats as loose chats and touches nothing on disk.
 */
import { create } from "zustand";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

interface ProjectRemovalState {
  /** Project id awaiting confirmation. */
  target: string | null;
  pending: boolean;
  request: (projectId: string) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export const useProjectRemoval = create<ProjectRemovalState>((set, get) => ({
  target: null,
  pending: false,

  request: (target) => set({ target, pending: false }),

  cancel: () => {
    if (!get().pending) set({ target: null });
  },

  confirm: async () => {
    const id = get().target;
    if (!id || get().pending) return;
    set({ pending: true });
    try {
      await ipc.deleteProject(id);
    } catch (err) {
      set({ pending: false });
      toast({ tone: "danger", title: t("shell.projectRemoveFailed"), description: ipcErrorMessage(err) });
      return;
    }
    set({ target: null, pending: false });
    const ui = useUi.getState();
    if ((ui.view.kind === "project" && ui.view.id === id) || (ui.view.kind === "draft" && ui.view.projectId === id)) {
      ui.navigate({ kind: "home" });
    }
    if (ui.selectedProjectId === id) {
      ui.selectProject(null);
    }
    await useNav.getState().load();
    void useDashboard.getState().load();
    toast({ tone: "ok", title: t("shell.projectRemoved") });
  },
}));
