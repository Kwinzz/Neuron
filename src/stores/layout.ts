import { create } from "zustand";

/** Sidebar width bounds (px). */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 440;
export const SIDEBAR_DEFAULT = 256;

const STORAGE_KEY = "neuron.sidebarWidth";

const clamp = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

/** Per-machine convenience: storage may be unavailable, the default then applies. */
function readWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

interface LayoutState {
  sidebarWidth: number;
  /** Live update while dragging (not persisted). */
  setSidebarWidth: (width: number) => void;
  /** Persist the current width (end of a drag / reset). */
  saveSidebarWidth: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarWidth: readWidth(),
  setSidebarWidth: (width) => set({ sidebarWidth: clamp(width) }),
  saveSidebarWidth: () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(get().sidebarWidth));
    } catch {
      // ignore: width just won't survive a restart
    }
  },
}));
