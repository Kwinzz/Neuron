import { STATUS } from "@/lib/status";
import { useEffect } from "react";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { TurnOutcome } from "@/bindings/TurnOutcome";
import { type MessageKey, t } from "@/i18n";
import { events, notify } from "@/lib/ipc";
import { useActivity } from "@/stores/activity";
import { useChat } from "@/stores/chat";
import { useDashboard } from "@/stores/dashboard";
import { type Attention, attentionFor, useLive } from "@/stores/live";
import { useSettings } from "@/stores/settings";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

// Message keys, not texts: translated when the toast / notification is raised (current language).
const ATTENTION_TOAST: Record<Attention, { tone: "ok" | "warn" | "danger"; title: MessageKey }> = {
  done: { tone: "ok", title: "shell.toastChatDone" },
  approval: { tone: "warn", title: "shell.toastApproval" },
  error: { tone: "danger", title: "shell.toastChatError" },
};

/** Approvals that are really a question or a plan to review get their own wording. */
function approvalTitle(toolName: string | null | undefined, fallback: string): string {
  if (toolName === "AskUserQuestion") return t("shell.notifyQuestion");
  if (toolName === "ExitPlanMode") return t("shell.notifyPlanReady");
  return fallback;
}

/** Last summary written by the agent, per chat (TurnSummary arrives just before the final status). */
const summaries = new Map<string, TurnSummaryEvent>();

type TurnSummaryEvent = Extract<AgentEventEnvelope["event"], { kind: "TurnSummary" }>;

const OUTCOME_TITLE: Record<TurnOutcome, MessageKey> = {
  success: "shell.outcomeSuccess",
  partial: "shell.outcomePartial",
  failure: "shell.outcomeFailure",
  unknown: "shell.notifyDone",
};

/** Notification text: the agent's own summary and verdict when it gave one, else the chat title. */
function notificationText(threadId: string, why: Attention, detail: string | null): { title: string; body: string } {
  const chatTitle = useLive.getState().threads[threadId]?.title || t("common.untitledChat");
  if (why === "approval") return { title: approvalTitle(detail, t("shell.notifyApproval")), body: chatTitle };
  const summary = summaries.get(threadId);
  summaries.delete(threadId);
  if (why === "error") {
    return { title: t("shell.notifyErrorTitle", { title: chatTitle }), body: summary?.summary || t("shell.notifyErrorBody") };
  }
  if (!summary) return { title: t("shell.notifyDone"), body: chatTitle };
  return { title: `${t(OUTCOME_TITLE[summary.outcome])} · ${chatTitle}`, body: summary.summary || chatTitle };
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
    let unlistenUsage: (() => void) | null = null;

    // Usage read from the CLI logs (terminal sessions included): refresh the dashboard.
    events
      .onUsageChanged(() => useDashboard.getState().scheduleRefresh())
      .then((fn) => {
        if (disposed) fn();
        else unlistenUsage = fn;
      })
      .catch(() => undefined);

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
        const statusBefore = live.threads[envelope.threadId]?.status;
        live.applyEvent(envelope, useUi.getState().focusedThreadId);
        const statusAfter = useLive.getState().threads[envelope.threadId]?.status;

        const after = useLive.getState().attention[envelope.threadId];
        if (after && after !== before) {
          const thread = useLive.getState().threads[envelope.threadId];
          const meta = ATTENTION_TOAST[after];
          const title = t(meta.title);
          toast({
            tone: meta.tone,
            title: envelope.event.kind === "PermissionRequest" ? approvalTitle(envelope.event.toolName, title) : title,
            description: thread?.title || t("common.untitledChat"),
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

        // Reload the lists only when a turn starts or ends (or fails) — not at every intermediate status (tool
        // started, approval asked…): each reload re-reads the whole dashboard, which made the UI stutter.
        const kind = envelope.event.kind;
        const phaseChanged =
          statusBefore === undefined ||
          statusAfter === undefined ||
          STATUS[statusBefore].active !== STATUS[statusAfter].active;
        if (kind === "TokenUsageUpdate" || kind === "ThreadError" || (kind === "ThreadStatusChanged" && phaseChanged)) {
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
      unlistenUsage?.();
    };
  }, []);
}
