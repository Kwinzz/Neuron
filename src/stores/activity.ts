/**
 * Live activity log per chat, for the "Threads live" mini terminals: tool calls (with their result),
 * the line being written, permissions, status changes — plus the sub-agents a chat launched and the
 * calls they made (`parentId`). Fed only by `useAgentEventBridge`; capped, in memory only.
 */
import { create } from "zustand";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { SubagentStatus } from "@/bindings/SubagentStatus";

export type TermLineKind = "tool" | "text" | "thinking" | "permission" | "status" | "error";
export type TermLineState = "running" | "ok" | "error";

export interface TermLine {
  id: string;
  ts: number;
  kind: TermLineKind;
  /** One line, already shortened. */
  text: string;
  state: TermLineState | null;
  /** Tool name (kind "tool"). */
  tool: string | null;
  /** First line of the tool result (kind "tool", once finished). */
  result: string | null;
  /** Set for lines produced by a sub-agent: the tool call that launched it. */
  parentId: string | null;
}

export interface SubagentInfo {
  /** Tool call that launched the sub-agent. */
  id: string;
  description: string;
  type: string | null;
  status: SubagentStatus;
  toolUses: number | null;
  tokens: number | null;
  lastTool: string | null;
  startedAt: number;
  endedAt: number | null;
}

interface ActivityState {
  lines: Record<string, TermLine[]>;
  subagents: Record<string, Record<string, SubagentInfo>>;
  apply: (envelope: AgentEventEnvelope) => void;
  clear: (threadId: string) => void;
}

/** Lines kept per chat (sub-agent lines included). */
const MAX_LINES = 120;
const MAX_TEXT = 220;
/** Tools that launch a sub-agent (Claude Code). */
const LAUNCHERS = new Set(["Agent", "Task"]);

export const EMPTY_LINES: TermLine[] = [];
export const EMPTY_SUBAGENTS: Record<string, SubagentInfo> = {};

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

/** Last non-empty line of a growing text. */
function lastLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]?.trim();
    if (l) return oneLine(l);
  }
  return "";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Short description of a tool call from its input (fallback when the backend gave no activity). */
function describeInput(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const pick =
      str(o.command) ?? str(o.file_path) ?? str(o.path) ?? str(o.pattern) ?? str(o.url) ?? str(o.query) ?? str(o.description);
    if (pick) return `${name} ${oneLine(pick)}`;
  }
  return name;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}:${++counter}`;

function upsert(list: TermLine[], line: TermLine): TermLine[] {
  const index = list.findIndex((l) => l.id === line.id);
  const next = index >= 0 ? list.map((l, i) => (i === index ? line : l)) : [...list, line];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

// Streaming text arrives in many small deltas: accumulate them and publish at most once per frame.
const pendingText = new Map<string, { threadId: string; messageId: string; thinking: boolean; text: string }>();
const fullText = new Map<string, string>();
let frame = 0;

export const useActivity = create<ActivityState>((set, get) => {
  const flush = () => {
    frame = 0;
    if (pendingText.size === 0) return;
    const batch = [...pendingText.values()];
    pendingText.clear();
    set((state) => {
      const lines = { ...state.lines };
      for (const p of batch) {
        const key = `${p.threadId}:${p.messageId}`;
        const text = (fullText.get(key) ?? "") + p.text;
        fullText.set(key, text);
        const shown = lastLine(text);
        if (!shown) continue;
        const id = `msg:${p.messageId}`;
        const prev = (lines[p.threadId] ?? EMPTY_LINES).find((l) => l.id === id);
        lines[p.threadId] = upsert(lines[p.threadId] ?? EMPTY_LINES, {
          id,
          ts: prev?.ts ?? Date.now(),
          kind: p.thinking ? "thinking" : "text",
          text: shown,
          state: null,
          tool: null,
          result: null,
          parentId: null,
        });
      }
      return { lines };
    });
  };

  const push = (threadId: string, line: TermLine) =>
    set((state) => ({ lines: { ...state.lines, [threadId]: upsert(state.lines[threadId] ?? EMPTY_LINES, line) } }));

  const setSubagent = (threadId: string, info: SubagentInfo) =>
    set((state) => ({
      subagents: { ...state.subagents, [threadId]: { ...(state.subagents[threadId] ?? EMPTY_SUBAGENTS), [info.id]: info } },
    }));

  const base = { state: null, tool: null, result: null, parentId: null } as const;

  return {
    lines: {},
    subagents: {},

    apply: ({ threadId, ts, event }) => {
      switch (event.kind) {
        case "MessageDelta": {
          const key = `${threadId}:${event.messageId}`;
          const p = pendingText.get(key);
          if (p) p.text += event.text;
          else pendingText.set(key, { threadId, messageId: event.messageId, thinking: event.channel === "thinking", text: event.text });
          if (!frame) frame = requestAnimationFrame(flush);
          return;
        }
        case "MessageCompleted":
          fullText.delete(`${threadId}:${event.messageId}`);
          return;
        case "ToolCallStart": {
          push(threadId, {
            ...base,
            id: event.toolCallId,
            ts,
            kind: "tool",
            text: oneLine(event.activity ?? describeInput(event.name, event.input)),
            state: "running",
            tool: event.name,
            parentId: event.parentToolCallId,
          });
          if (LAUNCHERS.has(event.name)) {
            const input = (event.input ?? {}) as Record<string, unknown>;
            setSubagent(threadId, {
              id: event.toolCallId,
              description: oneLine(str(input.description) ?? "Sous-agent"),
              type: str(input.subagent_type),
              status: "running",
              toolUses: null,
              tokens: null,
              lastTool: null,
              startedAt: ts,
              endedAt: null,
            });
          }
          return;
        }
        case "ToolCallResult": {
          const prev = (get().lines[threadId] ?? EMPTY_LINES).find((l) => l.id === event.toolCallId);
          if (prev) {
            push(threadId, {
              ...prev,
              state: event.isError ? "error" : "ok",
              result: lastLine(event.output.split("\n").find((l) => l.trim()) ?? "") || null,
            });
          }
          const sub = get().subagents[threadId]?.[event.toolCallId];
          if (sub && sub.status === "running") {
            setSubagent(threadId, { ...sub, status: event.isError ? "failed" : "completed", endedAt: ts });
          }
          return;
        }
        case "SubagentUpdate": {
          const prev = get().subagents[threadId]?.[event.toolCallId];
          setSubagent(threadId, {
            id: event.toolCallId,
            description: prev?.description ?? oneLine(event.description ?? "Sous-agent"),
            type: event.subagentType ?? prev?.type ?? null,
            status: event.status,
            toolUses: event.toolUses ?? prev?.toolUses ?? null,
            tokens: event.tokens ?? prev?.tokens ?? null,
            lastTool: event.lastTool ?? prev?.lastTool ?? null,
            startedAt: prev?.startedAt ?? ts,
            endedAt: event.status === "running" ? null : ts,
          });
          return;
        }
        case "PermissionRequest":
          push(threadId, { ...base, id: `perm:${event.requestId}`, ts, kind: "permission", text: oneLine(event.description || event.toolName), tool: event.toolName });
          return;
        case "ThreadError":
          push(threadId, { ...base, id: nextId("err"), ts, kind: "error", text: oneLine(event.message), state: "error" });
          return;
        case "ThreadStatusChanged": {
          const label =
            event.status === "done" ? "Tour terminé" : event.status === "cancelled" ? "Arrêté" : event.status === "starting" ? "Nouveau message" : null;
          if (label) {
            push(threadId, { ...base, id: nextId("st"), ts, kind: "status", text: label, state: event.status === "done" ? "ok" : null });
          }
          return;
        }
        default:
          return;
      }
    },

    clear: (threadId) =>
      set((state) => {
        const lines = { ...state.lines };
        const subagents = { ...state.subagents };
        delete lines[threadId];
        delete subagents[threadId];
        return { lines, subagents };
      }),
  };
});
