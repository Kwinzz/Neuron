/**
 * Live thread state for the dock, fed by `agent://event`.
 * Components subscribe per thread (`useLive(s => s.threads[id])`) so one thread's updates never
 * re-render the others.
 */
import { create } from "zustand";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { ThreadStatus } from "@/bindings/ThreadStatus";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { ipc } from "@/lib/ipc";
import { keepIfSame } from "@/lib/sameValue";
import { STATUS } from "@/lib/status";

export interface LiveThread extends ThreadSummary {
  detail: string | null;
  /** When the current active run started (for the timer). */
  runStartedAt: number;
  lastEventAt: number;
  errorMessage: string | null;
}

/** Why a background thread wants attention. */
export type Attention = "done" | "approval" | "error";

/** Finished threads stay visible in the dock for this long. */
export const DOCK_LINGER_MS = 15 * 60_000;

interface LiveState {
  threads: Record<string, LiveThread>;
  attention: Record<string, Attention>;

  hydrate: (summaries: ThreadSummary[]) => void;
  applyEvent: (envelope: AgentEventEnvelope, focusedThreadId: string | null) => void;
  markSeen: (id: string) => void;
  clearAttention: () => void;
  /** A deleted chat leaves the dock and every live view. */
  remove: (id: string) => void;
}

function fromSummary(s: ThreadSummary, previous?: LiveThread): LiveThread {
  const active = STATUS[s.status].active;
  // Live-only fields survive a refresh only while the thread stays in the same active/inactive phase;
  // otherwise (e.g. a finished thread restarted, or data re-seeded) they are derived from the summary again.
  const samePhase = previous !== undefined && STATUS[previous.status].active === active;
  return {
    ...s,
    detail: samePhase ? previous.detail : null,
    runStartedAt: samePhase ? previous.runStartedAt : active ? s.updatedAt : s.createdAt,
    lastEventAt: Math.max(previous?.lastEventAt ?? 0, s.updatedAt),
    errorMessage: samePhase && !active ? previous.errorMessage : null,
  };
}

export function attentionFor(status: ThreadStatus): Attention | null {
  if (status === "done") return "done";
  if (status === "awaiting_approval") return "approval";
  if (status === "error") return "error";
  return null;
}

/** Threads whose metadata is being fetched, to avoid duplicate `get_thread` calls. */
const pending = new Set<string>();

export const useLive = create<LiveState>((set, get) => ({
  threads: {},
  attention: {},

  hydrate: (summaries) =>
    set((state) => {
      // Periodic refreshes mostly bring unchanged rows: keep those objects (and the map itself when nothing
      // changed), otherwise every chat in the sidebar, dock and header re-renders at each refresh.
      let threads: Record<string, LiveThread> | null = null;
      for (const s of summaries) {
        const prev = state.threads[s.id];
        // Never let an older DB snapshot overwrite fresher live state (status, tokens, timers)…
        const next =
          prev && prev.lastEventAt > s.updatedAt
            ? // …but static fields (edited outside the event stream) always follow the database.
              {
                ...prev,
                title: s.title,
                model: s.model,
                effort: s.effort,
                permissionMode: s.permissionMode,
                cwd: s.cwd,
                projectId: s.projectId,
                projectName: s.projectName,
                pinnedAt: s.pinnedAt,
                archivedAt: s.archivedAt,
              }
            : fromSummary(s, prev);
        const kept = keepIfSame(prev, next);
        if (kept !== prev) {
          threads ??= { ...state.threads };
          threads[s.id] = kept;
        }
      }
      return threads ? { threads } : state;
    }),

  applyEvent: ({ threadId, ts, event }, focusedThreadId) => {
    const current = get().threads[threadId];
    if (!current) {
      if (!pending.has(threadId)) {
        pending.add(threadId);
        ipc
          .getThread(threadId)
          .then((summary) => get().hydrate([summary]))
          .catch(() => undefined)
          .finally(() => pending.delete(threadId));
      }
      return;
    }

    set((state) => {
      const t = state.threads[threadId];
      if (!t) return state;
      let next: LiveThread = { ...t, lastEventAt: ts, updatedAt: ts };
      let attention = state.attention;

      switch (event.kind) {
        case "ThreadStatusChanged": {
          const wasActive = STATUS[t.status].active;
          const isActive = STATUS[event.status].active;
          next = {
            ...next,
            status: event.status,
            detail: event.detail,
            runStartedAt: !wasActive && isActive ? ts : t.runStartedAt,
            endedAt: isActive ? null : ts,
          };
          const why = attentionFor(event.status);
          if (why && threadId !== focusedThreadId) attention = { ...attention, [threadId]: why };
          break;
        }
        case "TokenUsageUpdate":
          next = {
            ...next,
            tokens: t.tokens + event.delta.input + event.delta.output,
            costUsd: t.costUsd + event.delta.costUsd,
          };
          break;
        case "ThreadError":
          next = {
            ...next,
            errorMessage: event.message,
            ...(event.fatal ? { status: "error" as const, detail: null, endedAt: ts } : {}),
          };
          if (event.fatal && threadId !== focusedThreadId) attention = { ...attention, [threadId]: "error" };
          break;
        case "PermissionRequest":
          next = { ...next, status: "awaiting_approval", detail: event.toolName };
          if (threadId !== focusedThreadId) attention = { ...attention, [threadId]: "approval" };
          break;
        case "PermissionResolved":
          if (attention[threadId] === "approval") {
            attention = { ...attention };
            delete attention[threadId];
          }
          break;
        case "PermissionModeChanged":
          next = { ...next, permissionMode: event.mode };
          break;
        case "MessageDelta":
        case "ToolCallStart":
        case "ToolCallResult":
          break;
      }
      return { threads: { ...state.threads, [threadId]: next }, attention };
    });
  },

  markSeen: (id) =>
    set((state) => {
      if (!(id in state.attention)) return state;
      const attention = { ...state.attention };
      delete attention[id];
      return { attention };
    }),

  clearAttention: () => set({ attention: {} }),

  remove: (id) =>
    set((state) => {
      if (!(id in state.threads) && !(id in state.attention)) return state;
      const threads = { ...state.threads };
      const attention = { ...state.attention };
      delete threads[id];
      delete attention[id];
      return { threads, attention };
    }),
}));

/** Ids shown in the dock: active threads first (newest run first), then recently finished. */
export function selectDockIds(state: LiveState, now: number): string[] {
  const all = Object.values(state.threads);
  const active = all
    .filter((t) => STATUS[t.status].active)
    .sort((a, b) => b.runStartedAt - a.runStartedAt);
  const recent = all
    .filter(
      (t) =>
        !STATUS[t.status].active &&
        t.status !== "idle" &&
        (t.id in state.attention || now - (t.endedAt ?? t.updatedAt) < DOCK_LINGER_MS),
    )
    .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt));
  return [...active, ...recent].map((t) => t.id);
}
