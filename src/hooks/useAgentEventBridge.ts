import { useEffect } from "react";
import { events, notify } from "@/lib/ipc";
import { useActivity } from "@/stores/activity";
import { useChat } from "@/stores/chat";
import { useDashboard } from "@/stores/dashboard";
import { type Attention, attentionFor, useLive } from "@/stores/live";
import { useSettings } from "@/stores/settings";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

const ATTENTION_TOAST: Record<Attention, { tone: "ok" | "warn" | "danger"; title: string }> = {
  done: { tone: "ok", title: "Chat terminé" },
  approval: { tone: "warn", title: "Approbation requise" },
  error: { tone: "danger", title: "Chat en erreur" },
};

const NOTIFY_TITLE: Record<Attention, string> = {
  done: "Réponse terminée",
  approval: "Autorisation demandée",
  error: "Erreur",
};

/** Last status notified per chat: one notification per transition. */
const notified = new Map<string, Attention>();

/** Native notification while the Neuron window is in the background (per Paramètres › Notifications). */
function maybeNotify(threadId: string, why: Attention | null): void {
  if (!why) {
    notified.delete(threadId);
    return;
  }
  if (notified.get(threadId) === why || document.hasFocus()) return;
  const prefs = useSettings.getState().settings?.notifications;
  if (!prefs?.enabled) return;
  const wanted = why === "done" ? prefs.onFinished : why === "approval" ? prefs.onPermission : prefs.onError;
  if (!wanted) return;
  notified.set(threadId, why);
  const thread = useLive.getState().threads[threadId];
  void notify.ensurePermission().then((ok) => {
    if (ok) notify.send(NOTIFY_TITLE[why], thread?.title || "Chat sans titre");
  });
}

/**
 * Mount once (AppShell): routes `agent://event` into the live store, refreshes the dashboard
 * (throttled) and raises a toast when a background thread needs attention.
 */
export function useAgentEventBridge(): void {
  useEffect(() => {
    let disposed = false;
    void useSettings.getState().load().catch(() => undefined);
    let unlisten: (() => void) | null = null;

    events
      .onAgentEvent((envelope) => {
        useChat.getState().enqueue(envelope);
        useActivity.getState().apply(envelope);
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

        if (envelope.event.kind === "ThreadStatusChanged") {
          maybeNotify(envelope.threadId, attentionFor(envelope.event.status));
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
