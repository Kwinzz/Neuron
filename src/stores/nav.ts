/**
 * Sidebar data: every project and every chat (the dashboard snapshot only carries recent ones).
 * Reloaded after create/rename/delete and, throttled, on agent events.
 */
import { keepIfSame } from "@/lib/sameValue";
import { create } from "zustand";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { ipc } from "@/lib/ipc";
import { useLive } from "@/stores/live";

const CHAT_LIMIT = 500;
const REFRESH_THROTTLE_MS = 3000;
const OPEN_KEY = "neuron.openProjects";
const OPEN_DEVICES_KEY = "neuron.openDevices";
const COLLAPSED_KEY = "neuron.collapsedSections";

/** Sidebar groups that fold away entirely (click on their label). */
export type SidebarSection = "projects" | "chats" | "devices";

function readOpen(key: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeOpen(key: string, value: Record<string, boolean>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not persisted */
  }
}

interface NavState {
  projects: ProjectSummary[];
  chats: ThreadSummary[];
  loaded: boolean;
  /** Expanded project folders. */
  openProjects: Record<string, boolean>;
  /** Expanded remote-device folders (absent = follow connected state). */
  openDevices: Record<string, boolean>;
  /** Folded sidebar groups. */
  collapsedSections: Record<string, boolean>;
  load: () => Promise<void>;
  scheduleRefresh: () => void;
  setProjectOpen: (projectId: string, open: boolean) => void;
  setDeviceOpen: (deviceId: string, open: boolean) => void;
  toggleSection: (section: SidebarSection) => void;
  setProjects: (projects: ProjectSummary[]) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useNav = create<NavState>((set, get) => ({
  projects: [],
  chats: [],
  loaded: false,
  openProjects: readOpen(OPEN_KEY),
  openDevices: readOpen(OPEN_DEVICES_KEY),
  collapsedSections: readOpen(COLLAPSED_KEY),

  load: async () => {
    try {
      const [projects, chats] = await Promise.all([ipc.listProjects(), ipc.listThreads(CHAT_LIMIT)]);
      useLive.getState().hydrate(chats);
      // Same lists as before (the usual case for a periodic refresh): keep them, the sidebar doesn't re-render.
      const state = get();
      set({ projects: keepIfSame(state.projects, projects), chats: keepIfSame(state.chats, chats), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  scheduleRefresh: () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void get().load();
    }, REFRESH_THROTTLE_MS);
  },

  setProjectOpen: (projectId, open) => {
    const openProjects = { ...get().openProjects, [projectId]: open };
    writeOpen(OPEN_KEY, openProjects);
    set({ openProjects });
  },

  setDeviceOpen: (deviceId, open) => {
    const openDevices = { ...get().openDevices, [deviceId]: open };
    writeOpen(OPEN_DEVICES_KEY, openDevices);
    set({ openDevices });
  },

  toggleSection: (section) => {
    const collapsedSections = { ...get().collapsedSections, [section]: !get().collapsedSections[section] };
    writeOpen(COLLAPSED_KEY, collapsedSections);
    set({ collapsedSections });
  },

  setProjects: (projects) => set({ projects }),
}));
