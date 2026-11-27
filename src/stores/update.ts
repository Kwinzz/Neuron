/** New versions of Neuron: last known answer, manual check, installation (Paramètres → Mises à jour, sidebar badge). */
import { create } from "zustand";
import type { UpdateInfo } from "@/bindings/UpdateInfo";
import type { UpdateProgress } from "@/bindings/UpdateProgress";
import { isTauri, updates } from "@/lib/ipc";

interface UpdateState {
  info: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  /** Download of the installer (Windows) or of the package (Linux), while installing. */
  progress: UpdateProgress | null;
  load: () => Promise<void>;
  check: () => Promise<UpdateInfo>;
  install: () => Promise<void>;
  setInfo: (info: UpdateInfo) => void;
  setProgress: (progress: UpdateProgress) => void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  info: null,
  checking: false,
  installing: false,
  progress: null,
  load: async () => {
    if (!isTauri()) return;
    const info = await updates.status();
    if (info) set({ info });
  },
  check: async () => {
    set({ checking: true });
    try {
      const info = await updates.check();
      set({ info });
      return info;
    } finally {
      set({ checking: false });
    }
  },
  install: async () => {
    if (get().installing) return;
    set({ installing: true, progress: null });
    try {
      await updates.install();
    } finally {
      // Windows and Linux package: the app quits (and restarts) right after; Linux from source: a terminal takes over.
      set({ installing: false });
    }
  },
  setInfo: (info) => set({ info }),
  setProgress: (progress) => set({ progress }),
}));
