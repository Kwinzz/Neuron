/**
 * « Nouveau projet », opened from anywhere (sidebar, a device's folder, Ctrl+K) and handled by one dialog
 * (`NewProjectDialog`, mounted once in AppShell).
 */
import { create } from "zustand";

interface NewProjectState {
  open: boolean;
  /** Device the project is created on (null = this PC), preset by the entry point. */
  device: string | null;
  show: (device?: string | null) => void;
  close: () => void;
}

export const useNewProject = create<NewProjectState>((set) => ({
  open: false,
  device: null,
  show: (device = null) => set({ open: true, device }),
  close: () => set({ open: false }),
}));
