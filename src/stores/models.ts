/** Model catalog per provider (Claude Code, Codex, Antigravity), loaded once from the backend. */
import { create } from "zustand";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ModelInfo } from "@/bindings/ModelInfo";
import type { ProviderCatalog } from "@/bindings/ProviderCatalog";
import { ipc } from "@/lib/ipc";

interface ModelsState {
  providers: ProviderCatalog[];
  loading: boolean;
  loaded: boolean;
  load: (refresh?: boolean) => Promise<void>;
}

export const useModels = create<ModelsState>((set, get) => ({
  providers: [],
  loading: false,
  loaded: false,
  load: async (refresh = false) => {
    if (get().loading || (get().loaded && !refresh)) return;
    set({ loading: true });
    try {
      set({ providers: await ipc.listModels(refresh), loaded: true, loading: false });
    } catch {
      set({ loading: false, loaded: true });
    }
  },
}));

export function findModel(providers: ProviderCatalog[], agent: AgentKind, id: string | null): ModelInfo | undefined {
  if (!id) return undefined;
  return providers.find((p) => p.agent === agent)?.models.find((m) => m.id === id);
}
