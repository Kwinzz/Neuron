import type { ChatSettings } from "@/lib/models";

/** Settings of the last new chat (shared by the « Nouveau chat » screen and the quick prompt window). */
const DEFAULTS_KEY = "neuron.chatDefaults";
const FALLBACK: ChatSettings = { agent: "claude_code", model: null, effort: null, permissionMode: "manual" };

export function readChatDefaults(): ChatSettings {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    return raw ? { ...FALLBACK, ...(JSON.parse(raw) as Partial<ChatSettings>) } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function saveChatDefaults(next: ChatSettings): void {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next));
  } catch {
    /* not persisted */
  }
}

/** Agent + model last used from the quick prompt window (its own memory, independent of « Nouveau chat »). */
const QUICK_KEY = "neuron.quickDefaults";

export type QuickModel = Pick<ChatSettings, "agent" | "model" | "effort">;

export function readQuickModel(): QuickModel | null {
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    return raw ? (JSON.parse(raw) as QuickModel) : null;
  } catch {
    return null;
  }
}

export function saveQuickModel(next: QuickModel): void {
  try {
    localStorage.setItem(QUICK_KEY, JSON.stringify(next));
  } catch {
    /* not persisted */
  }
}

/** Project last picked in the quick prompt window (null = no project). */
const QUICK_PROJECT_KEY = "neuron.quickProject";

export function readQuickProject(): string | null {
  try {
    return localStorage.getItem(QUICK_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function saveQuickProject(id: string | null): void {
  try {
    if (id) localStorage.setItem(QUICK_PROJECT_KEY, id);
    else localStorage.removeItem(QUICK_PROJECT_KEY);
  } catch {
    /* not persisted */
  }
}
