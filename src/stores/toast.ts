import { create } from "zustand";

export type ToastTone = "info" | "ok" | "warn" | "danger";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Optional click action (e.g. focus the thread). */
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const MAX_TOASTS = 4;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast, ttlMs = 5000) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
    setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<Toast, "id">, ttlMs?: number) => useToasts.getState().push(t, ttlMs);
