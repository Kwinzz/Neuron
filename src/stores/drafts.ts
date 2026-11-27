/**
 * Unsent composer drafts, keyed by chat id or `draft:<projectId|none>` for the new-chat screen.
 *
 * Composer initializes its local state from here on mount and writes changes via `useDrafts.getState().set(...)`
 * without subscribing, so typing never triggers store-driven re-renders. Only the text is persisted to
 * `localStorage` (capped at 200 non-empty entries); attachments stay in memory for the session.
 */
import { create } from "zustand";
import type { Attachment } from "@/bindings/Attachment";

export interface Draft {
  text: string;
  attachments: Attachment[];
}

const STORAGE_KEY = "neuron.drafts";
const MAX_PERSISTED = 200;

/** Key for a chat's draft (or the new-chat draft for a project / without project). */
export function draftKey(threadId: string | null, projectId: string | null): string {
  return threadId ?? `draft:${projectId ?? "none"}`;
}

/** In-memory mirror of persisted texts, in insertion order (oldest first for LRU eviction). */
const persistedTexts: Record<string, string> = {};

function loadPersisted(): Record<string, Draft> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const valid = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
    );
    const capped = valid.length > MAX_PERSISTED ? valid.slice(valid.length - MAX_PERSISTED) : valid;
    const drafts: Record<string, Draft> = {};
    for (const [key, text] of capped) {
      persistedTexts[key] = text;
      drafts[key] = { text, attachments: [] };
    }
    return drafts;
  } catch {
    return {};
  }
}

function syncStorage(key: string, text: string): void {
  const nonEmpty = text.trim().length > 0;
  const prev = persistedTexts[key];
  if (!nonEmpty && prev === undefined) return;
  if (nonEmpty && prev === text) return;

  if (nonEmpty) {
    // Re-insert so recently edited drafts stay at the end and the oldest are evicted first.
    delete persistedTexts[key];
    persistedTexts[key] = text;
    const keys = Object.keys(persistedTexts);
    if (keys.length > MAX_PERSISTED) {
      for (const oldKey of keys.slice(0, keys.length - MAX_PERSISTED)) {
        delete persistedTexts[oldKey];
      }
    }
  } else {
    delete persistedTexts[key];
  }

  try {
    if (Object.keys(persistedTexts).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedTexts));
    }
  } catch {
    // Storage unavailable or full: the in-memory draft still works.
  }
}

interface DraftsState {
  drafts: Record<string, Draft>;
  set: (key: string, draft: Draft) => void;
  clear: (key: string) => void;
}

export const useDrafts = create<DraftsState>((set, get) => ({
  drafts: loadPersisted(),

  set: (key, draft) => {
    if (draft.text.length === 0 && draft.attachments.length === 0) {
      get().clear(key);
      return;
    }
    syncStorage(key, draft.text);
    const prev = get().drafts[key];
    if (prev && prev.text === draft.text && prev.attachments === draft.attachments) return;
    set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
  },

  clear: (key) => {
    syncStorage(key, "");
    set((s) => {
      if (!(key in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    });
  },
}));

// ---- Composer text-fill event (e.g. « Modifier » on the last user message) --------------------

type FillListener = (key: string, text: string) => void;
const fillListeners = new Set<FillListener>();

/** Replace a chat composer's draft with `text`, moving the caret to the end and focusing it. */
export function fillComposer(key: string, text: string): void {
  const attachments = useDrafts.getState().drafts[key]?.attachments ?? [];
  useDrafts.getState().set(key, { text, attachments });
  for (const listener of fillListeners) listener(key, text);
}

/** Subscribe a mounted Composer to `fillComposer` calls. Returns the unsubscribe function. */
export function onComposerFill(listener: FillListener): () => void {
  fillListeners.add(listener);
  return () => {
    fillListeners.delete(listener);
  };
}
