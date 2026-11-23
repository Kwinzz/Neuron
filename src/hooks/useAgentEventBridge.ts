import { useEffect } from "react";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { TurnOutcome } from "@/bindings/TurnOutcome";
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

/** Approvals that are really a question or a plan to review get their own wording. */
function approvalTitle(toolName: string | null | undefined, fallback: string): string {
  if (toolName === "AskUserQuestion") return "L'agent pose une question";
  if (toolName === "ExitPlanMode") return "Plan prêt à valider";
  return fallback;
}

/** Last summary written by the agent, per chat (TurnSummary arrives just before the final status). */
const summaries = new Map<string, TurnSummaryEvent>();

type TurnSummaryEvent = Extract<AgentEventEnvelope["event"], { kind: "TurnSummary" }>;

const OUTCOME_TITLE: Record<TurnOutcome, string> = {
  success: "✅ Tâche réussie",
  partial: "⚠️ Tâche faite en partie",
  failure: "❌ Tâche non effectuée",
  unknown: "Réponse terminée",
};

/** Notification text: the agent's own summary and verdict when it gave one, else the chat title. */
function notificationText(threadId: string, why: Attention, detail: string | null): { title: string; body: string } {
  const chatTitle = useLive.getState().threads[threadId]?.title || "Chat sans titre";
  if (why === "approval") return { title: approvalTitle(detail, NOTIFY_TITLE.approval), body: chatTitle };
  const summary = summaries.get(threadId);
  summaries.delete(threadId);
  if (why === "error") {
    return { title: `❌ Erreur · ${chatTitle}`, body: summary?.summary || "L'agent s'est arrêté sur une erreur." };
  }
  if (!summary) return { title: NOTIFY_TITLE.done, body: chatTitle };
  return { title: `${OUTCOME_TITLE[summary.outcome]} · ${chatTitle}`, body: summary.summary || chatTitle };
}

/** Last status notified per chat: one notification per transition. */
const notified = new Map<string, Attention>();

/** Native notification while the Neuron window is in the background (per Paramètres › Notifications). */
function maybeNotify(threadId: string, why: Attention | null, detail: string | null = null): void {
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
  const { title, body } = notificationText(threadId, why, detail);
  void notify.ensurePermission().then((ok) => {
    if (ok) notify.send(title, body, threadId);
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
    let unlistenQuotas: (() => void) | null = null;
    let unlistenClicks: (() => void) | null = null;
    let unlistenNewChat: (() => void) | null = null;

    // Quick prompt « ouvrir » on « Nouveau chat »: the new-chat screen, in the chosen project.
    events
      .onNewChatRequested((projectId) => useUi.getState().startChat(projectId))
      .then((fn) => {
        if (disposed) fn();
        else unlistenNewChat = fn;
      })
      .catch(() => undefined);

    // Clicking a notification brings the window back (backend) and opens the chat it was about.
    events
      .onNotificationClicked((threadId) => {
        if (threadId) useUi.getState().focusThread(threadId);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenClicks = fn;
      })
      .catch(() => undefined);

    // Antigravity quotas are fetched apart from the turns (`agy --print /quota`).
    events
      .onQuotasChanged(() => useDashboard.getState().scheduleRefresh())
      .then((fn) => {
        if (disposed) fn();
        else unlistenQuotas = fn;
      })
      .catch(() => undefined);

    events
      .onAgentEvent((envelope) => {
        if (envelope.event.kind === "TurnSummary") summaries.set(envelope.threadId, envelope.event);
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
            title:
              envelope.event.kind === "PermissionRequest" ? approvalTitle(envelope.event.toolName, meta.title) : meta.title,
            description: thread?.title || "Chat sans titre",
            onClick: () => {
              useUi.getState().focusThread(envelope.threadId);
              useUi.getState().setDockOpen(true);
              useLive.getState().markSeen(envelope.threadId);
            },
          });
        }

        if (envelope.event.kind === "ThreadStatusChanged") {
          maybeNotify(envelope.threadId, attentionFor(envelope.event.status), envelope.event.detail);
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
      unlistenQuotas?.();
      unlistenClicks?.();
      unlistenNewChat?.();
    };
  }, []);
}
