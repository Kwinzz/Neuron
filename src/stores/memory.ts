/**
 * Global memory: list of memories, file location and MCP status. Refreshed when the memory changes
 * outside the app (memory.md edited, agent saved via MCP) — `memory://changed`.
 */
import { create } from "zustand";
import type { AgyMcpStatus } from "@/bindings/AgyMcpStatus";
import type { Memory } from "@/bindings/Memory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import type { MemoryInfo } from "@/bindings/MemoryInfo";
import { events, ipc, isTauri } from "@/lib/ipc";

interface MemoryState {
  items: Memory[];
  info: MemoryInfo | null;
  agy: AgyMcpStatus | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refreshAgy: () => Promise<void>;
  create: (category: MemoryCategory, content: string) => Promise<Memory>;
  update: (id: string, category: MemoryCategory, content: string) => Promise<Memory>;
  remove: (id: string) => Promise<void>;
  connectAgy: () => Promise<void>;
  disconnectAgy: () => Promise<void>;
}

let subscribed = false;

export const useMemory = create<MemoryState>((set, get) => ({
  items: [],
  info: null,
  agy: null,
  loaded: false,
  error: null,

  load: async () => {
    if (!isTauri()) return;
    if (!subscribed) {
      subscribed = true;
      void events.onMemoryChanged(() => void get().load());
    }
    try {
      const [items, info] = await Promise.all([ipc.listMemories(), get().info ?? ipc.memoryInfo()]);
      set({ items, info, loaded: true, error: null });
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },
  refreshAgy: async () => {
    if (!isTauri()) return;
    set({ agy: await ipc.antigravityMcpStatus() });
  },
  create: async (category, content) => {
    const saved = await ipc.createMemory(category, content);
    set({ items: await ipc.listMemories() });
    return saved;
  },
  update: async (id, category, content) => {
    const saved = await ipc.updateMemory(id, category, content);
    set({ items: await ipc.listMemories() });
    return saved;
  },
  remove: async (id) => {
    await ipc.deleteMemory(id);
    set({ items: get().items.filter((m) => m.id !== id) });
  },
  connectAgy: async () => set({ agy: await ipc.connectAntigravityMcp() }),
  disconnectAgy: async () => set({ agy: await ipc.disconnectAntigravityMcp() }),
}));
