import { create } from "zustand";

/** Sidebar width bounds (px). */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 440;
export const SIDEBAR_DEFAULT = 256;

/** Composer textarea height bounds (px). `null` = grow automatically with content up to `COMPOSER_AUTO_MAX`. */
export const COMPOSER_MIN_HEIGHT = 44;
export const COMPOSER_AUTO_MAX_HEIGHT = 10 * 24 + 20;
export const COMPOSER_MAX_HEIGHT = 600;

const SIDEBAR_STORAGE_KEY = "neuron.sidebarWidth";
const COMPOSER_STORAGE_KEY = "neuron.composerHeight";

const clampSidebar = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

/** Upper bound for manual composer resizing, never taking more than 60% of the viewport height. */
export function composerMaxHeight(): number {
  const viewportCap = typeof window !== "undefined" ? Math.floor(window.innerHeight * 0.6) : COMPOSER_MAX_HEIGHT;
  return Math.max(COMPOSER_AUTO_MAX_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, viewportCap));
}

const clampComposer = (h: number) => Math.round(Math.min(composerMaxHeight(), Math.max(COMPOSER_MIN_HEIGHT, h)));

/** Per-machine convenience: storage may be unavailable, the default then applies. */
function readWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampSidebar(saved) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function readComposerHeight(): number | null {
  try {
    const raw = window.localStorage.getItem(COMPOSER_STORAGE_KEY);
    if (raw === null) return null;
    const saved = Number(raw);
    return Number.isFinite(saved) && saved > COMPOSER_MIN_HEIGHT ? clampComposer(saved) : null;
  } catch {
    return null;
  }
}

interface LayoutState {
  sidebarWidth: number;
  /** Live update while dragging (not persisted). */
  setSidebarWidth: (width: number) => void;
  /** Persist the current width (end of a drag / reset). */
  saveSidebarWidth: () => void;
  /** Manual textarea height in px, or `null` for automatic sizing with content. */
  composerHeight: number | null;
  /** Live update while dragging (not persisted). `null` restores automatic sizing. */
  setComposerHeight: (height: number | null) => void;
  /** Persist the current manual composer height (or clear it when back to auto). */
  saveComposerHeight: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarWidth: readWidth(),
  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebar(width) }),
  saveSidebarWidth: () => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(get().sidebarWidth));
    } catch {
      // ignore: width just won't survive a restart
    }
  },
  composerHeight: readComposerHeight(),
  setComposerHeight: (height) => set({ composerHeight: height === null ? null : clampComposer(height) }),
  saveComposerHeight: () => {
    try {
      const h = get().composerHeight;
      if (h === null) window.localStorage.removeItem(COMPOSER_STORAGE_KEY);
      else window.localStorage.setItem(COMPOSER_STORAGE_KEY, String(h));
    } catch {
      // ignore: height just won't survive a restart
    }
  },
}));
