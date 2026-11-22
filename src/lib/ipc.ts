/**
 * The ONLY module allowed to call Tauri `invoke` / `listen`.
 * Every command and event is typed with bindings generated from Rust (`src/bindings`, via ts-rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { AppInfo } from "@/bindings/AppInfo";
import type { DashboardSnapshot } from "@/bindings/DashboardSnapshot";
import type { IpcError } from "@/bindings/IpcError";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { ProviderUpdate } from "@/bindings/ProviderUpdate";
import type { ProviderUsage } from "@/bindings/ProviderUsage";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import type { UsageRange } from "@/bindings/UsageRange";
import type { UsageReport } from "@/bindings/UsageReport";

/** Must match `AGENT_EVENT_CHANNEL` in `src-tauri/src/agents/events.rs`. */
export const AGENT_EVENT_CHANNEL = "agent://event";

/** True when running inside the Tauri webview (false in a plain browser via `npm run dev`). */
export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

export function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

/** Human-readable message for any rejected IPC call. */
export function ipcErrorMessage(err: unknown): string {
  if (isIpcError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),

  // Mission Control / dock / palette
  dashboardSnapshot: (range?: UsageRange) => invoke<DashboardSnapshot>("dashboard_snapshot", { range }),
  usageReport: (range: UsageRange) => invoke<UsageReport>("usage_report", { range }),
  updateProvider: (update: ProviderUpdate) => invoke<ProviderUsage>("update_provider", { update }),
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  listThreads: (limit?: number) => invoke<ThreadSummary[]>("list_threads", { limit }),
  getThread: (id: string) => invoke<ThreadSummary>("get_thread", { id }),

  // Debug builds only (rejected in release)
  dev: {
    seedDemo: () => invoke<number>("dev_seed_demo"),
    clearDemo: () => invoke<void>("dev_clear_demo"),
    simulateActivity: () => invoke<number>("dev_simulate_activity"),
  },
} as const;

export const events = {
  /** Subscribe to every normalized agent event. Returns the unsubscribe function. */
  onAgentEvent: (handler: (payload: AgentEventEnvelope) => void): Promise<UnlistenFn> =>
    listen<AgentEventEnvelope>(AGENT_EVENT_CHANNEL, (e) => handler(e.payload)),
} as const;
