import { create } from "zustand";
import type { AgentKind } from "@/bindings/AgentKind";

/**
 * - home: Accueil (dashboard)
 * - draft: empty chat, created on its first message (optionally inside a project)
 * - thread: an existing chat
 * - project: a project page (context.md editor, git snapshot, chats)
 * - memory: global memory (~/.neuron/memory.md) and its MCP server
 * - settings: Paramètres
 */
export type View =
  | { kind: "home" }
  | { kind: "draft"; projectId: string | null; agent?: AgentKind }
  | { kind: "thread"; id: string }
  | { kind: "project"; id: string; tab?: "context" | "chats" }
  | { kind: "memory" }
  | { kind: "settings"; section?: SettingsSectionTarget };

export type SettingsSection =
  | "general"
  | "background"
  | "agents"
  | "costs"
  | "devices"
  | "notifications"
  | "context"
  | "generic"
  | "updates";

/** Includes legacy section ids (redirected by `resolveSettingsSection`) so existing callers keep working. */
export type SettingsSectionTarget = SettingsSection | "shortcuts";

export function resolveSettingsSection(section?: SettingsSectionTarget): SettingsSection {
  if (!section) return "general";
  if (section === "shortcuts") return "background";
  return section;
}

const DOCK_KEY = "neuron.dockOpen";

function readDockPref(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeDockPref(open: boolean): void {
  try {
    localStorage.setItem(DOCK_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable — preference simply not persisted */
  }
}

interface UiState {
  view: View;
  paletteOpen: boolean;
  /** Keyboard shortcuts help dialog. */
  shortcutsOpen: boolean;
  dockOpen: boolean;
  /** Chat currently open (dock highlight, attention suppression). */
  focusedThreadId: string | null;
  /** Project filter selected for the dock (null = all). */
  selectedProjectId: string | null;
  /** Dock cards showing their sub-agents' terminals (this session only). */
  dockExpanded: Record<string, boolean>;

  navigate: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  /** Open Paramètres (optionally on a section; legacy ids are redirected). */
  openSettings: (section?: SettingsSectionTarget) => void;
  togglePalette: () => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  /** Open an empty chat (inside `projectId` and/or with `agent` when given). No dialog: the chat is created on send. */
  startChat: (projectId?: string | null, agent?: AgentKind) => void;
  /** Open a project page. */
  openProject: (id: string, tab?: "context" | "chats") => void;
  /** Open an existing chat (null = back to Accueil). */
  focusThread: (id: string | null) => void;
  selectProject: (id: string | null) => void;
  setDockExpanded: (threadId: string, expanded: boolean) => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: { kind: "home" },
  paletteOpen: false,
  shortcutsOpen: false,
  dockOpen: readDockPref(),
  focusedThreadId: null,
  selectedProjectId: null,
  dockExpanded: {},

  navigate: (view) => set({ view, paletteOpen: false, focusedThreadId: view.kind === "thread" ? view.id : null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, paletteOpen: false }),
  openSettings: (section) =>
    get().navigate(section ? { kind: "settings", section: resolveSettingsSection(section) } : { kind: "settings" }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setDockOpen: (dockOpen) => {
    writeDockPref(dockOpen);
    set({ dockOpen });
  },
  toggleDock: () => get().setDockOpen(!get().dockOpen),
  startChat: (projectId = null, agent) =>
    get().navigate(agent ? { kind: "draft", projectId, agent } : { kind: "draft", projectId }),
  openProject: (id, tab) => get().navigate(tab ? { kind: "project", id, tab } : { kind: "project", id }),
  focusThread: (id) => get().navigate(id ? { kind: "thread", id } : { kind: "home" }),
  selectProject: (selectedProjectId) => set({ selectedProjectId }),
  setDockExpanded: (threadId, expanded) => set({ dockExpanded: { ...get().dockExpanded, [threadId]: expanded } }),
}));
