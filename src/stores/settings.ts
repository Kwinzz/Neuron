/** Paramètres (one JSON document on the backend). */
import { create } from "zustand";
import type { AppSettings } from "@/bindings/AppSettings";
import { ipc, isTauri } from "@/lib/ipc";

interface SettingsState {
  settings: AppSettings | null;
  loaded: boolean;
  load: () => Promise<void>;
  /** Persist (validated/normalized by the backend) and return what was stored. */
  save: (next: AppSettings) => Promise<AppSettings>;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  loaded: false,
  load: async () => {
    if (!isTauri()) return;
    set({ settings: await ipc.getAppSettings(), loaded: true });
  },
  save: async (next) => {
    const stored = await ipc.updateAppSettings(next);
    set({ settings: stored, loaded: true });
    return stored;
  },
}));
