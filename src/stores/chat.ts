/**
 * Chat timelines, one per thread, fed by history (`get_thread_history`) + live `agent://event`s.
 *
 * Performance: events are buffered and applied once per animation frame, so a fast token stream
 * produces at most ~60 store updates/s; only the thread being displayed re-renders, and within it
 * only the items whose object identity changed (ChatItem objects are replaced, never mutated).
 */
import { create } from "zustand";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { Attachment } from "@/bindings/Attachment";
import type { ChatItem } from "@/bindings/ChatItem";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";

export interface ChatThread {
  items: ChatItem[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

interface ChatState {
  threads: Record<string, ChatThread>;
  /** Load history once (no-op when already loaded or loading). */
  load: (threadId: string, force?: boolean) => Promise<void>;
  send: (threadId: string, text: string, attachments?: Attachment[]) => Promise<boolean>;
  respondPermission: (threadId: string, requestId: string, allow: boolean) => Promise<void>;
  stop: (threadId: string) => Promise<void>;
  /** Called by the agent-event bridge for every event. */
  enqueue: (envelope: AgentEventEnvelope) => void;
}

const EMPTY: ChatThread = { items: [], loaded: false, loading: false, error: null };

let localSeq = 0;
const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(localSeq++).toString(36)}`;

/** Apply one event to a timeline (pure). */
function reduce(items: ChatItem[], { ts, event }: AgentEventEnvelope): ChatItem[] {
  const indexOf = (id: string) => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i]?.id === id) return i;
    return -1;
  };
  const replaceAt = (i: number, item: ChatItem) => {
    const next = items.slice();
    next[i] = item;
    return next;
  };
  const endStreaming = (list: ChatItem[]) =>
    list.map((it) => ((it.kind === "text" || it.kind === "thinking") && it.streaming ? { ...it, streaming: false } : it));

  switch (event.kind) {
    case "MessageDelta": {
      const i = indexOf(event.messageId);
      const existing = i >= 0 ? items[i] : undefined;
      if (existing && (existing.kind === "text" || existing.kind === "thinking")) {
        if (!existing.streaming) return items; // already persisted (history loaded after the stream)
        return replaceAt(i, { ...existing, text: existing.text + event.text });
      }
      const kind = event.channel === "thinking" ? "thinking" : "text";
      return [...items, { kind, id: event.messageId, text: event.text, streaming: true }];
    }
    case "MessageCompleted": {
      const i = indexOf(event.messageId);
      const it = items[i];
      if (!it || (it.kind !== "text" && it.kind !== "thinking") || !it.streaming) return items;
      return replaceAt(i, { ...it, streaming: false });
    }
    case "ToolCallStart": {
      if (indexOf(event.toolCallId) >= 0) return items;
      return [
        ...items,
        {
          kind: "tool",
          id: event.toolCallId,
          name: event.name,
          input: event.input,
          activity: event.activity,
          status: "running",
          output: null,
          startedAt: ts,
          endedAt: null,
        },
      ];
    }
    case "ToolCallResult": {
      const i = indexOf(event.toolCallId);
      const it = items[i];
      if (!it || it.kind !== "tool") return items;
      return replaceAt(i, { ...it, status: event.isError ? "error" : "ok", output: event.output, endedAt: ts });
    }
    case "PermissionRequest":
      if (indexOf(event.requestId) >= 0) return items;
      return [
        ...items,
        {
          kind: "permission",
          id: event.requestId,
          toolName: event.toolName,
          description: event.description,
          input: event.input,
          state: "pending",
        },
      ];
    case "CommandOutput":
      if (indexOf(event.messageId) >= 0) return items;
      return [...endStreaming(items), { kind: "command", id: event.messageId, name: event.name, output: event.text }];
    case "TokenUsageUpdate": {
      // A local slash command (/usage, /context…) used no model: no end-of-turn marker (same rule as the backend).
      const d = event.delta;
      const free = d.input + d.output + d.cacheRead + d.cacheWrite === 0 && d.costUsd === 0;
      if (free && items[items.length - 1]?.kind === "command") return items;
      return [...endStreaming(items), { kind: "turn", id: localId("turn"), usage: event.delta, durationMs: null, ts }];
    }
    case "ThreadError":
      return [...endStreaming(items), { kind: "error", id: localId("err"), message: event.message }];
    case "ThreadStatusChanged": {
      if (event.status === "done" || event.status === "error" || event.status === "cancelled") {
        // Unanswered permission cards can no longer be acted upon.
        const settled = items.map((it) =>
          it.kind === "permission" && it.state === "pending" ? { ...it, state: "denied" as const } : it,
        );
        return endStreaming(settled);
      }
      return items;
    }
    case "SubagentUpdate":
      // Sub-agent progress is shown in the live dock; the chat timeline shows its tool calls.
      return items;
  }
}

// ---- per-frame batching -----------------------------------------------------------------------
const queue = new Map<string, AgentEventEnvelope[]>();
let frame: number | null = null;

export const useChat = create<ChatState>((set, get) => {
  const patch = (threadId: string, fn: (t: ChatThread) => ChatThread) =>
    set((s) => ({ threads: { ...s.threads, [threadId]: fn(s.threads[threadId] ?? EMPTY) } }));

  const flush = () => {
    frame = null;
    if (queue.size === 0) return;
    const pending = new Map(queue);
    queue.clear();
    set((s) => {
      const threads = { ...s.threads };
      for (const [threadId, events] of pending) {
        const t = threads[threadId];
        if (!t?.loaded) continue; // history (loaded later) already contains persisted items
        let items = t.items;
        for (const e of events) items = reduce(items, e);
        if (items !== t.items) threads[threadId] = { ...t, items };
      }
      return { threads };
    });
  };

  return {
    threads: {},

    load: async (threadId, force = false) => {
      const current = get().threads[threadId];
      if (!force && (current?.loaded || current?.loading)) return;
      patch(threadId, (t) => ({ ...t, loading: true, error: null }));
      try {
        const items = await ipc.threadHistory(threadId);
        // Replay events that arrived during the load (dedup is handled by `reduce`).
        const buffered = queue.get(threadId) ?? [];
        queue.delete(threadId);
        patch(threadId, () => ({ items: buffered.reduce(reduce, items), loaded: true, loading: false, error: null }));
      } catch (err) {
        patch(threadId, (t) => ({ ...t, loading: false, error: ipcErrorMessage(err) }));
      }
    },

    send: async (threadId, text, attachments = []) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return false;
      patch(threadId, (t) => ({
        ...t,
        items: [...t.items, { kind: "user", id: localId("user"), text: trimmed, ts: Date.now(), attachments }],
      }));
      try {
        await ipc.sendMessage(threadId, trimmed, attachments);
        return true;
      } catch (err) {
        const message = ipcErrorMessage(err);
        patch(threadId, (t) => ({ ...t, items: [...t.items, { kind: "error", id: localId("err"), message }] }));
        return false;
      }
    },

    respondPermission: async (threadId, requestId, allow) => {
      const setState = (state: "pending" | "allowed" | "denied") =>
        patch(threadId, (t) => ({
          ...t,
          items: t.items.map((it) => (it.kind === "permission" && it.id === requestId ? { ...it, state } : it)),
        }));
      setState(allow ? "allowed" : "denied");
      try {
        await ipc.respondPermission(threadId, requestId, allow);
      } catch (err) {
        setState("denied");
        toast({ tone: "danger", title: "Réponse impossible", description: ipcErrorMessage(err) });
      }
    },

    stop: async (threadId) => {
      try {
        await ipc.stopThread(threadId);
      } catch (err) {
        toast({ tone: "danger", title: "Arrêt impossible", description: ipcErrorMessage(err) });
      }
    },

    enqueue: (envelope) => {
      const t = get().threads[envelope.threadId];
      if (!t || (!t.loaded && !t.loading)) return; // nobody displays this thread yet
      const list = queue.get(envelope.threadId);
      if (list) list.push(envelope);
      else queue.set(envelope.threadId, [envelope]);
      if (t.loaded && frame === null) frame = requestAnimationFrame(flush);
    },
  };
});

/** Exposed for tests / debugging. */
export const __reduceChat = reduce;
