/**
 * Chat organization mutations shared by the sidebar menu, inline rename and chat header.
 * Each action updates the live and nav stores right away, then reloads nav & dashboard to stay in sync.
 */
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";

/** Fired by the command palette to focus the open chat's inline title editor in ThreadHeader. */
export const RENAME_CHAT_EVENT = "neuron:rename-chat";

function applySummary(updated: ThreadSummary): void {
  useLive.getState().hydrate([updated]);
  useNav.setState((s) => ({
    chats: s.chats.map((c) => (c.id === updated.id ? updated : c)),
  }));
  void useNav.getState().load();
  void useDashboard.getState().load();
}

function setOptimisticTitle(threadId: string, title: string): void {
  useLive.setState((s) => {
    const prev = s.threads[threadId];
    if (!prev || prev.title === title) return s;
    return { threads: { ...s.threads, [threadId]: { ...prev, title } } };
  });
  useNav.setState((s) => {
    let changed = false;
    const chats = s.chats.map((c) => {
      if (c.id !== threadId || c.title === title) return c;
      changed = true;
      return { ...c, title };
    });
    return changed ? { chats } : s;
  });
}

/** Rename a chat (optimistic, with rollback + toast on error). Returns true on success. */
export async function renameChat(threadId: string, title: string): Promise<boolean> {
  const trimmed = title.trim();
  if (!trimmed) return false;
  const previous =
    useLive.getState().threads[threadId]?.title ??
    useNav.getState().chats.find((c) => c.id === threadId)?.title ??
    "";
  if (trimmed === previous) return true;

  setOptimisticTitle(threadId, trimmed);
  try {
    await ipc.renameThread(threadId, trimmed);
    void useNav.getState().load();
    void useDashboard.getState().load();
    return true;
  } catch (err) {
    setOptimisticTitle(threadId, previous);
    toast({
      tone: "danger",
      title: t("chat.renameFailed"),
      description: ipcErrorMessage(err),
    });
    return false;
  }
}

export async function setChatPinned(threadId: string, pinned: boolean): Promise<void> {
  try {
    const updated = await ipc.setThreadPinned(threadId, pinned);
    applySummary(updated);
  } catch (err) {
    toast({
      tone: "danger",
      title: t(pinned ? "chat.pinFailed" : "chat.unpinFailed"),
      description: ipcErrorMessage(err),
    });
  }
}

export async function setChatArchived(threadId: string, archived: boolean): Promise<void> {
  try {
    const updated = await ipc.setThreadArchived(threadId, archived);
    applySummary(updated);
  } catch (err) {
    toast({
      tone: "danger",
      title: t(archived ? "chat.archiveFailed" : "chat.unarchiveFailed"),
      description: ipcErrorMessage(err),
    });
  }
}

export async function moveChatToProject(threadId: string, projectId: string | null): Promise<void> {
  try {
    const updated = await ipc.moveThread(threadId, projectId);
    applySummary(updated);
  } catch (err) {
    toast({
      tone: "danger",
      title: t("chat.moveFailed"),
      description: ipcErrorMessage(err),
    });
  }
}
