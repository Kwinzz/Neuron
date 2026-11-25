/**
 * Chat deletion, asked from anywhere (sidebar, chat header) and confirmed in one dialog (`DeleteChatDialog`,
 * mounted once in AppShell). The backend stops the chat's agent, then deletes it with its history.
 */
import { create } from "zustand";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useActivity } from "@/stores/activity";
import { useChat } from "@/stores/chat";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

interface ChatDeletionState {
  /** Chat awaiting confirmation. */
  target: string | null;
  pending: boolean;
  request: (threadId: string) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export const useChatDeletion = create<ChatDeletionState>((set, get) => ({
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
      await ipc.deleteThread(id);
    } catch (err) {
      set({ pending: false });
      toast({ tone: "danger", title: t("chat.deleteChatFailed"), description: ipcErrorMessage(err) });
      return;
    }
    set({ target: null, pending: false });
    const ui = useUi.getState();
    if (ui.view.kind === "thread" && ui.view.id === id) ui.navigate({ kind: "home" });
    useLive.getState().remove(id);
    useChat.getState().forget(id);
    useActivity.getState().clear(id);
    useNav.setState((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
    void useNav.getState().load();
    void useDashboard.getState().load();
    toast({ tone: "ok", title: t("chat.chatDeleted") });
  },
}));
