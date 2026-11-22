import { useEffect } from "react";
import { events } from "@/lib/ipc";
import { useChat } from "@/stores/chat";
import { useDashboard } from "@/stores/dashboard";
import { type Attention, useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

const ATTENTION_TOAST: Record<Attention, { tone: "ok" | "warn" | "danger"; title: string }> = {
  done: { tone: "ok", title: "Chat terminé" },
  approval: { tone: "warn", title: "Approbation requise" },
  error: { tone: "danger", title: "Chat en erreur" },
};

/**
 * Mount once (AppShell): routes `agent://event` into the live store, refreshes the dashboard
 * (throttled) and raises a toast when a background thread needs attention.
 */
export function useAgentEventBridge(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    events
      .onAgentEvent((envelope) => {
        useChat.getState().enqueue(envelope);
        const live = useLive.getState();
        const before = live.attention[envelope.threadId];
        live.applyEvent(envelope, useUi.getState().focusedThreadId);

        const after = useLive.getState().attention[envelope.threadId];
        if (after && after !== before) {
          const thread = useLive.getState().threads[envelope.threadId];
          const meta = ATTENTION_TOAST[after];
          toast({
            tone: meta.tone,
            title: meta.title,
            description: thread?.title || "Chat sans titre",
            onClick: () => {
              useUi.getState().focusThread(envelope.threadId);
              useUi.getState().setDockOpen(true);
              useLive.getState().markSeen(envelope.threadId);
            },
          });
        }

        const kind = envelope.event.kind;
        if (kind === "TokenUsageUpdate" || kind === "ThreadStatusChanged" || kind === "ThreadError") {
          useDashboard.getState().scheduleRefresh();
          useNav.getState().scheduleRefresh();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
