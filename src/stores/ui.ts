import { create } from "zustand";

export type View = { kind: "home" } | { kind: "thread"; id: string };

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
  dockOpen: boolean;
  newThreadOpen: boolean;
  /** Thread currently open in the chat view (dock highlight, attention suppression). */
  focusedThreadId: string | null;
  /** Project filter selected in the sidebar (null = all). */
  selectedProjectId: string | null;

  navigate: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setNewThreadOpen: (open: boolean) => void;
  /** Open a thread in the chat view (null = back to home). */
  focusThread: (id: string | null) => void;
  selectProject: (id: string | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: { kind: "home" },
  paletteOpen: false,
  dockOpen: readDockPref(),
  newThreadOpen: false,
  focusedThreadId: null,
  selectedProjectId: null,

  navigate: (view) => set({ view, focusedThreadId: view.kind === "thread" ? view.id : null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setDockOpen: (dockOpen) => {
    writeDockPref(dockOpen);
    set({ dockOpen });
  },
  toggleDock: () => get().setDockOpen(!get().dockOpen),
  setNewThreadOpen: (newThreadOpen) => set({ newThreadOpen, paletteOpen: false }),
  focusThread: (id) => get().navigate(id ? { kind: "thread", id } : { kind: "home" }),
  selectProject: (selectedProjectId) => set({ selectedProjectId }),
}));
