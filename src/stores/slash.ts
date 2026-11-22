/** Slash commands per provider + folder, fetched once (the backend caches 15 min too). */
import { create } from "zustand";
import type { AgentKind } from "@/bindings/AgentKind";
import type { SlashCommand } from "@/bindings/SlashCommand";
import { ipc, isTauri } from "@/lib/ipc";

interface Entry {
  commands: SlashCommand[];
  loading: boolean;
}

interface SlashState {
  entries: Record<string, Entry>;
  load: (agent: AgentKind, cwd: string | null) => void;
}

export const slashKey = (agent: AgentKind, cwd: string | null) => `${agent}|${cwd ?? ""}`;
export const EMPTY_COMMANDS: SlashCommand[] = [];

export const useSlash = create<SlashState>((set, get) => ({
  entries: {},
  load: (agent, cwd) => {
    const key = slashKey(agent, cwd);
    if (!isTauri() || get().entries[key]) return;
    set((s) => ({ entries: { ...s.entries, [key]: { commands: EMPTY_COMMANDS, loading: true } } }));
    ipc
      .listSlashCommands(agent, cwd)
      .catch(() => EMPTY_COMMANDS)
      .then((commands) => set((s) => ({ entries: { ...s.entries, [key]: { commands, loading: false } } })));
  },
}));
