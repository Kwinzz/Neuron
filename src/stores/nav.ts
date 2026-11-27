/**
 * Sidebar data: every project and every chat (the dashboard snapshot only carries recent ones).
 * Reloaded after create/rename/delete and, throttled, on agent events.
 */
import { keepIfSame } from "@/lib/sameValue";
import { create } from "zustand";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { RemoteHost } from "@/bindings/RemoteHost";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { deviceOfProject, deviceOfThread } from "@/lib/deviceRouting";
import { fuzzyScore, normalize } from "@/lib/fuzzy";
import { ipc } from "@/lib/ipc";
import { useLive } from "@/stores/live";

const CHAT_LIMIT = 500;
const REFRESH_THROTTLE_MS = 3000;
const OPEN_KEY = "neuron.openProjects";
const OPEN_DEVICES_KEY = "neuron.openDevices";
const COLLAPSED_KEY = "neuron.collapsedSections";

/** Sidebar groups that fold away entirely (click on their label). */
export type SidebarSection = "projects" | "chats" | "devices" | "archived";

/** Sections that start folded until the user opens them. */
const DEFAULT_COLLAPSED: Partial<Record<SidebarSection, boolean>> = {
  archived: true,
};

export function isSectionCollapsed(collapsedSections: Record<string, boolean>, section: SidebarSection): boolean {
  return collapsedSections[section] ?? DEFAULT_COLLAPSED[section] ?? false;
}

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
    const current = isSectionCollapsed(get().collapsedSections, section);
    const collapsedSections = { ...get().collapsedSections, [section]: !current };
    writeOpen(COLLAPSED_KEY, collapsedSections);
    set({ collapsedSections });
  },

  setProjects: (projects) => set({ projects }),
}));

/** Pinned chats first (most recently pinned first), then unpinned by recency. */
export function compareChats(a: ThreadSummary, b: ThreadSummary): number {
  const ap = a.pinnedAt !== null;
  const bp = b.pinnedAt !== null;
  if (ap !== bp) return ap ? -1 : 1;
  if (ap && bp && a.pinnedAt !== b.pinnedAt) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
  return b.updatedAt - a.updatedAt;
}

/** Most recently archived first. */
export function compareArchived(a: ThreadSummary, b: ThreadSummary): number {
  const diff = (b.archivedAt ?? 0) - (a.archivedAt ?? 0);
  return diff !== 0 ? diff : b.updatedAt - a.updatedAt;
}

export interface SidebarFilterOptions {
  query: string;
  untitledLabel: string;
}

export interface SidebarPartition {
  visibleLocalProjects: ProjectSummary[];
  visibleProjectsByDevice: Map<string, ProjectSummary[]>;
  visibleHosts: readonly RemoteHost[];
  chatsByProject: Map<string, ThreadSummary[]>;
  localLooseChats: ThreadSummary[];
  looseChatsByDevice: Map<string, ThreadSummary[]>;
  chatsByDevice: Map<string, ThreadSummary[]>;
  archivedChats: ThreadSummary[];
  /** Non-archived chat ids in exact top-to-bottom sidebar display order (pinned first, folders as shown). */
  orderedChatIds: string[];
  hasAnyMatch: boolean;
}

/**
 * Partition and sort projects and chats exactly as the sidebar renders them (local projects, loose chats,
 * remote devices and their projects/loose chats, archived chats), plus the flat non-archived id order used by Alt+↑/↓.
 */
export function partitionSidebar(
  projects: readonly ProjectSummary[],
  chats: readonly ThreadSummary[],
  hosts: readonly RemoteHost[],
  filter?: SidebarFilterOptions,
): SidebarPartition {
  const normalizedQuery = filter ? normalize(filter.query.trim()) : "";
  const filtering = normalizedQuery.length > 0;
  const untitledLabel = filter?.untitledLabel ?? "";

  const localProjects: ProjectSummary[] = [];
  const projectsByDevice = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const device = deviceOfProject(p.id);
    if (device === null) {
      localProjects.push(p);
    } else {
      const list = projectsByDevice.get(device);
      if (list) list.push(p);
      else projectsByDevice.set(device, [p]);
    }
  }

  const scores = filtering ? new Map<string, number>() : null;
  const chatsByProject = new Map<string, ThreadSummary[]>();
  const localLooseChats: ThreadSummary[] = [];
  const looseChatsByDevice = new Map<string, ThreadSummary[]>();
  const chatsByDevice = new Map<string, ThreadSummary[]>();
  const archivedChats: ThreadSummary[] = [];

  for (const c of chats) {
    if (scores) {
      const score = fuzzyScore(normalizedQuery, normalize(c.title || untitledLabel));
      if (score === null) continue;
      scores.set(c.id, score);
    }

    if (c.archivedAt !== null) {
      archivedChats.push(c);
      continue;
    }

    const device = deviceOfThread(c.id) ?? deviceOfProject(c.projectId);
    if (device !== null) {
      const all = chatsByDevice.get(device);
      if (all) all.push(c);
      else chatsByDevice.set(device, [c]);
    }
    if (c.projectId !== null) {
      const list = chatsByProject.get(c.projectId);
      if (list) list.push(c);
      else chatsByProject.set(c.projectId, [c]);
    } else if (device === null) {
      localLooseChats.push(c);
    } else {
      const list = looseChatsByDevice.get(device);
      if (list) list.push(c);
      else looseChatsByDevice.set(device, [c]);
    }
  }

  const sortActive = (list: ThreadSummary[]) => {
    if (scores) {
      list.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || compareChats(a, b));
    } else {
      list.sort(compareChats);
    }
  };

  sortActive(localLooseChats);
  for (const list of chatsByProject.values()) sortActive(list);
  for (const list of looseChatsByDevice.values()) sortActive(list);
  if (scores) {
    archivedChats.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || compareArchived(a, b));
  } else {
    archivedChats.sort(compareArchived);
  }

  const visibleLocalProjects = filtering
    ? localProjects.filter((p) => (chatsByProject.get(p.id)?.length ?? 0) > 0)
    : localProjects;

  const visibleProjectsByDevice = new Map<string, ProjectSummary[]>();
  for (const [device, list] of projectsByDevice.entries()) {
    visibleProjectsByDevice.set(
      device,
      filtering ? list.filter((p) => (chatsByProject.get(p.id)?.length ?? 0) > 0) : list,
    );
  }

  const visibleHosts = filtering
    ? hosts.filter(
        (h) =>
          (visibleProjectsByDevice.get(h.nodeId)?.length ?? 0) > 0 ||
          (looseChatsByDevice.get(h.nodeId)?.length ?? 0) > 0,
      )
    : hosts;

  const orderedChatIds: string[] = [];
  for (const p of visibleLocalProjects) {
    const list = chatsByProject.get(p.id);
    if (list) {
      for (const c of list) orderedChatIds.push(c.id);
    }
  }
  for (const c of localLooseChats) orderedChatIds.push(c.id);
  for (const h of visibleHosts) {
    const deviceProjects = visibleProjectsByDevice.get(h.nodeId);
    if (deviceProjects) {
      for (const p of deviceProjects) {
        const list = chatsByProject.get(p.id);
        if (list) {
          for (const c of list) orderedChatIds.push(c.id);
        }
      }
    }
    const deviceLoose = looseChatsByDevice.get(h.nodeId);
    if (deviceLoose) {
      for (const c of deviceLoose) orderedChatIds.push(c.id);
    }
  }

  const hasAnyMatch =
    visibleLocalProjects.length > 0 ||
    localLooseChats.length > 0 ||
    visibleHosts.length > 0 ||
    archivedChats.length > 0;

  return {
    visibleLocalProjects,
    visibleProjectsByDevice,
    visibleHosts,
    chatsByProject,
    localLooseChats,
    looseChatsByDevice,
    chatsByDevice,
    archivedChats,
    orderedChatIds,
    hasAnyMatch,
  };
}

let cachedProjects: readonly ProjectSummary[] | null = null;
let cachedChats: readonly ThreadSummary[] | null = null;
let cachedHosts: readonly RemoteHost[] | null = null;
let cachedOrderedIds: readonly string[] = [];

/** Memoized non-archived chat ids in sidebar display order (pinned first, folders as shown, archived excluded). */
export function getSidebarChatIds(
  projects: readonly ProjectSummary[],
  chats: readonly ThreadSummary[],
  hosts: readonly RemoteHost[],
): readonly string[] {
  if (projects === cachedProjects && chats === cachedChats && hosts === cachedHosts) {
    return cachedOrderedIds;
  }
  cachedProjects = projects;
  cachedChats = chats;
  cachedHosts = hosts;
  cachedOrderedIds = partitionSidebar(projects, chats, hosts).orderedChatIds;
  return cachedOrderedIds;
}
