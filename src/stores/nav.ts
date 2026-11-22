/**
 * Sidebar data: every project and every chat (the dashboard snapshot only carries recent ones).
 * Reloaded after create/rename/delete and, throttled, on agent events.
 */
import { create } from "zustand";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { ipc } from "@/lib/ipc";
import { useLive } from "@/stores/live";

const CHAT_LIMIT = 500;
const REFRESH_THROTTLE_MS = 3000;
const OPEN_KEY = "neuron.openProjects";

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

interface NavState {
  projects: ProjectSummary[];
  chats: ThreadSummary[];
  loaded: boolean;
  /** Expanded project folders. */
  openProjects: Record<string, boolean>;
  load: () => Promise<void>;
  scheduleRefresh: () => void;
  setProjectOpen: (projectId: string, open: boolean) => void;
  setProjects: (projects: ProjectSummary[]) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useNav = create<NavState>((set, get) => ({
  projects: [],
  chats: [],
  loaded: false,
  openProjects: readOpen(),

  load: async () => {
    try {
      const [projects, chats] = await Promise.all([ipc.listProjects(), ipc.listThreads(CHAT_LIMIT)]);
      useLive.getState().hydrate(chats);
      set({ projects, chats, loaded: true });
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
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openProjects));
    } catch {
      /* not persisted */
    }
    set({ openProjects });
  },

  setProjects: (projects) => set({ projects }),
}));
