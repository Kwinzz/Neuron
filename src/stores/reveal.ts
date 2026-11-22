/**
 * Which assistant texts are still being revealed (smooth typing). The agent cursor stays visible while
 * any text reveals, even after the agent finished its turn (Codex sends whole messages at the end).
 */
import { create } from "zustand";

interface RevealState {
  revealing: Record<string, true>;
  set: (id: string, on: boolean) => void;
}

export const useReveal = create<RevealState>((set) => ({
  revealing: {},
  set: (id, on) =>
    set((s) => {
      if (on === (id in s.revealing)) return s;
      const revealing = { ...s.revealing };
      if (on) revealing[id] = true;
      else delete revealing[id];
      return { revealing };
    }),
}));

/** Primitive selector (never a new object): true while any text reveals. */
export const selectAnyRevealing = (s: RevealState) => Object.keys(s.revealing).length > 0;
