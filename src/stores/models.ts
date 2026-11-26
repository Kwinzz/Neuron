/** Model catalog per provider (Claude Code, Codex, Antigravity), cached per device. */
import { useEffect } from "react";
import { create } from "zustand";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ModelInfo } from "@/bindings/ModelInfo";
import type { ProviderCatalog } from "@/bindings/ProviderCatalog";
import { ipc } from "@/lib/ipc";

const EMPTY_PROVIDERS: ProviderCatalog[] = [];

interface ModelsState {
  providers: ProviderCatalog[];
  loading: boolean;
  loaded: boolean;
  remote: Record<string, ProviderCatalog[]>;
  remoteLoading: Record<string, boolean>;
  remoteLoaded: Record<string, boolean>;
  load: (refresh?: boolean) => Promise<void>;
  loadFor: (device: string | null, refresh?: boolean) => Promise<void>;
}

export const useModels = create<ModelsState>((set, get) => ({
  providers: [],
  loading: false,
  loaded: false,
  remote: {},
  remoteLoading: {},
  remoteLoaded: {},
  load: async (refresh = false) => {
    if (get().loading || (get().loaded && !refresh)) return;
    set({ loading: true });
    try {
      set({ providers: await ipc.listModels(refresh), loaded: true, loading: false });
    } catch {
      set({ loading: false, loaded: true });
    }
  },
  loadFor: async (device, refresh = false) => {
    if (!device) return get().load(refresh);
    const state = get();
    if (state.remoteLoading[device] || (state.remoteLoaded[device] && !refresh)) return;
    set((s) => ({ remoteLoading: { ...s.remoteLoading, [device]: true } }));
    try {
      const list = await ipc.listModels(refresh, device);
      set((s) => ({
        remote: { ...s.remote, [device]: list },
        remoteLoaded: { ...s.remoteLoaded, [device]: true },
        remoteLoading: { ...s.remoteLoading, [device]: false },
      }));
    } catch {
      set((s) => ({
        remoteLoaded: { ...s.remoteLoaded, [device]: true },
        remoteLoading: { ...s.remoteLoading, [device]: false },
      }));
    }
  },
}));

/** Providers available on `device` (null = this PC); triggers loading once if absent. */
export function useDeviceProviders(device: string | null = null): ProviderCatalog[] {
  const providers = useModels((s) => (device ? (s.remote[device] ?? EMPTY_PROVIDERS) : s.providers));
  const shouldLoad = useModels((s) =>
    device ? !s.remoteLoaded[device] && !s.remoteLoading[device] : !s.loaded && !s.loading,
  );

  useEffect(() => {
    if (shouldLoad) void useModels.getState().loadFor(device);
  }, [device, shouldLoad]);

  return providers;
}

/** Whether the model catalog for `device` (null = this PC) is currently loading. */
export function useDeviceModelsLoading(device: string | null = null): boolean {
  return useModels((s) => (device ? Boolean(s.remoteLoading[device]) : s.loading));
}

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
