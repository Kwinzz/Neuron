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

/** Model (or model family) for a stored id — a family also matches its per-level variant ids. */
export function findModel(providers: ProviderCatalog[], agent: AgentKind, id: string | null): ModelInfo | undefined {
  if (!id) return undefined;
  return providers
    .find((p) => p.agent === agent)
    ?.models.find((m) => m.id === id || (m.effortModels != null && Object.values(m.effortModels).includes(id)));
}

/**
 * Concrete id to send to the CLI. Families whose reasoning level is a separate model (Antigravity
 * `gemini-4-neon-high`) resolve to the variant of the chosen level (or the default level).
 */
export function resolveModelId(info: ModelInfo, effort: string | null): string {
  if (!info.effortModels) return info.id;
  const level = effort ?? info.defaultEffort;
  return (level ? info.effortModels[level] : undefined) ?? Object.values(info.effortModels)[0] ?? info.id;
}
