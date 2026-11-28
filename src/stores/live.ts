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

const DOCK_DISMISSED_KEY = "neuron.dockDismissed";
const DISMISSED_TTL_MS = 24 * 60 * 60_000;

function readDismissed(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DOCK_DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const cutoff = Date.now() - DISMISSED_TTL_MS;
    const out: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === "number" && ts > cutoff) out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, number>) {
  try {
    window.localStorage.setItem(DOCK_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

interface LiveState {
  threads: Record<string, LiveThread>;
  attention: Record<string, Attention>;
  /** Threads manually closed from the Live threads dock (`id -> dismissedAtMs`). */
  dockDismissed: Record<string, number>;

  hydrate: (summaries: ThreadSummary[]) => void;
  applyEvent: (envelope: AgentEventEnvelope, focusedThreadId: string | null) => void;
  markSeen: (id: string) => void;
  clearAttention: () => void;
  /** Hide a single thread card from the Live threads dock (does not stop or delete the chat). */
  dismissFromDock: (id: string) => void;
  /** Hide multiple finished thread cards from the Live threads dock at once. */
  dismissFinishedFromDock: (ids: string[]) => void;
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
  dockDismissed: readDismissed(),

  hydrate: (summaries) =>
    set((state) => {
      // Periodic refreshes mostly bring unchanged rows: keep those objects (and the map itself when nothing
      // changed), otherwise every chat in the sidebar, dock and header re-renders at each refresh.
      let threads: Record<string, LiveThread> | null = null;
      let dockDismissed: Record<string, number> | null = null;
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
                workspace: s.workspace,
              }
            : fromSummary(s, prev);
        const kept = keepIfSame(prev, next);
        if (kept !== prev) {
          threads ??= { ...state.threads };
          threads[s.id] = kept;
        }
        // A dismissed thread re-enters the dock when a new run starts after it was closed.
        const dismissedAt = state.dockDismissed[s.id];
        if (
          dismissedAt !== undefined &&
          STATUS[s.status].active &&
          (!prev || !STATUS[prev.status].active) &&
          s.updatedAt > dismissedAt
        ) {
          dockDismissed ??= { ...state.dockDismissed };
          delete dockDismissed[s.id];
        }
      }
      if (dockDismissed) writeDismissed(dockDismissed);
      if (!threads && !dockDismissed) return state;
      return {
        ...(threads ? { threads } : {}),
        ...(dockDismissed ? { dockDismissed } : {}),
      };
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
      let dockDismissed = state.dockDismissed;

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
          if (!wasActive && isActive && threadId in dockDismissed) {
            dockDismissed = { ...dockDismissed };
            delete dockDismissed[threadId];
            writeDismissed(dockDismissed);
          }
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
      return { threads: { ...state.threads, [threadId]: next }, attention, dockDismissed };
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

  dismissFromDock: (id) =>
    set((state) => {
      const dockDismissed = { ...state.dockDismissed, [id]: Date.now() };
      writeDismissed(dockDismissed);
      if (id in state.attention) {
        const attention = { ...state.attention };
        delete attention[id];
        return { dockDismissed, attention };
      }
      return { dockDismissed };
    }),

  dismissFinishedFromDock: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const now = Date.now();
      const dockDismissed = { ...state.dockDismissed };
      let attention: Record<string, Attention> | null = null;
      let changed = false;
      for (const id of ids) {
        const thread = state.threads[id];
        if (thread && STATUS[thread.status].active) continue;
        dockDismissed[id] = now;
        changed = true;
        if (id in state.attention) {
          attention ??= { ...state.attention };
          delete attention[id];
        }
      }
      if (!changed) return state;
      writeDismissed(dockDismissed);
      return attention ? { dockDismissed, attention } : { dockDismissed };
    }),

  remove: (id) =>
    set((state) => {
      if (!(id in state.threads) && !(id in state.attention) && !(id in state.dockDismissed)) return state;
      const threads = { ...state.threads };
      const attention = { ...state.attention };
      const dockDismissed = { ...state.dockDismissed };
      delete threads[id];
      delete attention[id];
      if (id in dockDismissed) {
        delete dockDismissed[id];
        writeDismissed(dockDismissed);
      }
      return { threads, attention, dockDismissed };
    }),
}));

/** Ids shown in the dock: active threads first (newest run first), then recently finished. */
export function selectDockIds(state: LiveState, now: number): string[] {
  const all = Object.values(state.threads).filter((t) => !(t.id in state.dockDismissed));
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
