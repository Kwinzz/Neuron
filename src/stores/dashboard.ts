import { create } from "zustand";
import type { DashboardSnapshot } from "@/bindings/DashboardSnapshot";
import type { ProviderUpdate } from "@/bindings/ProviderUpdate";
import type { UsageRange } from "@/bindings/UsageRange";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { keepIfSame } from "@/lib/sameValue";
import { useLive } from "@/stores/live";

const REFRESH_THROTTLE_MS = 2500;

interface DashboardState {
  snapshot: DashboardSnapshot | null;
  range: UsageRange;
  error: string | null;
  /** True only while the very first snapshot is loading. */
  loading: boolean;

  load: () => Promise<void>;
  setRange: (range: UsageRange) => Promise<void>;
  /** Throttled reload, called when live events change usage or statuses. */
  scheduleRefresh: () => void;
  updateProvider: (update: ProviderUpdate) => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let requestSeq = 0;

export const useDashboard = create<DashboardState>((set, get) => ({
  snapshot: null,
  range: "week",
  error: null,
  loading: true,

  load: async () => {
    const seq = ++requestSeq;
    try {
      const snapshot = await ipc.dashboardSnapshot(get().range);
      if (seq !== requestSeq) return; // a newer request superseded this one
      useLive.getState().hydrate([...snapshot.activeThreads, ...snapshot.recentThreads]);
      // Keep unchanged parts (providers, usage, lists…): the cards reading them don't re-render.
      const prev = get().snapshot;
      const merged: DashboardSnapshot = prev
        ? {
            ...snapshot,
            providers: keepIfSame(prev.providers, snapshot.providers),
            usage: keepIfSame(prev.usage, snapshot.usage),
            activeThreads: keepIfSame(prev.activeThreads, snapshot.activeThreads),
            recentThreads: keepIfSame(prev.recentThreads, snapshot.recentThreads),
            projects: keepIfSame(prev.projects, snapshot.projects),
            liveQuotas: keepIfSame(prev.liveQuotas, snapshot.liveQuotas),
          }
        : snapshot;
      set({ snapshot: merged, error: null, loading: false });
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: ipcErrorMessage(err), loading: false });
    }
  },

  setRange: async (range) => {
    if (range === get().range) return;
    set({ range });
    const seq = ++requestSeq;
    try {
      const usage = await ipc.usageReport(range);
      if (seq !== requestSeq) return;
      const snapshot = get().snapshot;
      if (snapshot) set({ snapshot: { ...snapshot, usage }, error: null });
    } catch (err) {
      if (seq === requestSeq) set({ error: ipcErrorMessage(err) });
    }
  },

  scheduleRefresh: () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().load();
    }, REFRESH_THROTTLE_MS);
  },

  updateProvider: async (update) => {
    const usage = await ipc.updateProvider(update);
    const snapshot = get().snapshot;
    if (!snapshot) return;
    set({
      snapshot: {
        ...snapshot,
        providers: snapshot.providers.map((p) => (p.provider.id === usage.provider.id ? usage : p)),
      },
    });
  },
}));
