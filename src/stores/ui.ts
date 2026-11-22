import { create } from "zustand";

export type View = { kind: "home" };

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
  /** Thread currently focused by the user (dock highlight; chat view from Phase 2). */
  focusedThreadId: string | null;
  /** Project filter selected in the sidebar (null = all). */
  selectedProjectId: string | null;

  navigate: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  focusThread: (id: string | null) => void;
  selectProject: (id: string | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: { kind: "home" },
  paletteOpen: false,
  dockOpen: readDockPref(),
  focusedThreadId: null,
  selectedProjectId: null,

  navigate: (view) => set({ view }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setDockOpen: (dockOpen) => {
    writeDockPref(dockOpen);
    set({ dockOpen });
  },
  toggleDock: () => get().setDockOpen(!get().dockOpen),
  focusThread: (focusedThreadId) => set({ focusedThreadId }),
  selectProject: (selectedProjectId) => set({ selectedProjectId }),
}));
