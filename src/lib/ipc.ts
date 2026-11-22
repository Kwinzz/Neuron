/**
 * The ONLY module allowed to call Tauri `invoke` / `listen`.
 * Every command and event is typed with bindings generated from Rust (`src/bindings`, via ts-rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { AppInfo } from "@/bindings/AppInfo";
import type { ChatItem } from "@/bindings/ChatItem";
import type { ContextBundle } from "@/bindings/ContextBundle";
import type { ProjectContextFile } from "@/bindings/ProjectContextFile";
import type { ProjectOverview } from "@/bindings/ProjectOverview";
import type { NewThreadInput } from "@/bindings/NewThreadInput";
import type { ProviderCatalog } from "@/bindings/ProviderCatalog";
import type { ThreadSettingsInput } from "@/bindings/ThreadSettingsInput";
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
  /** Forward a frontend diagnostic to the backend log (never throws). */
  log: (level: "error" | "warn" | "info", message: string) =>
    invoke<void>("frontend_log", { level, message }).catch(() => undefined),

  // Accueil / dock / palette
  dashboardSnapshot: (range?: UsageRange) => invoke<DashboardSnapshot>("dashboard_snapshot", { range }),
  usageReport: (range: UsageRange) => invoke<UsageReport>("usage_report", { range }),
  updateProvider: (update: ProviderUpdate) => invoke<ProviderUsage>("update_provider", { update }),
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  listThreads: (limit?: number) => invoke<ThreadSummary[]>("list_threads", { limit }),
  getThread: (id: string) => invoke<ThreadSummary>("get_thread", { id }),

  // Threads & chat
  createThread: (input: NewThreadInput) => invoke<ThreadSummary>("create_thread", { input }),
  sendMessage: (threadId: string, text: string) => invoke<void>("send_message", { threadId, text }),
  respondPermission: (threadId: string, requestId: string, allow: boolean) =>
    invoke<void>("respond_permission", { threadId, requestId, allow }),
  stopThread: (threadId: string) => invoke<void>("stop_thread", { threadId }),
  threadHistory: (threadId: string) => invoke<ChatItem[]>("get_thread_history", { threadId }),
  renameThread: (threadId: string, title: string) => invoke<void>("rename_thread", { threadId, title }),
  deleteThread: (threadId: string) => invoke<void>("delete_thread", { threadId }),
  runningThreads: () => invoke<string[]>("running_threads"),
  promptHistory: (projectId?: string | null) => invoke<string[]>("prompt_history", { projectId: projectId ?? null }),
  defaultCwd: () => invoke<string>("default_cwd"),
  updateThreadSettings: (threadId: string, settings: ThreadSettingsInput) =>
    invoke<ThreadSummary>("update_thread_settings", { threadId, settings }),
  createProject: (path: string, name?: string) =>
    invoke<ProjectSummary[]>("create_project", { path, name: name ?? null }),
  deleteProject: (projectId: string) => invoke<ProjectSummary[]>("delete_project", { projectId }),
  // Project context (.neuron/context.md) & injected context
  projectContext: (projectId: string) => invoke<ProjectContextFile>("project_context", { projectId }),
  saveProjectContext: (projectId: string, content: string) =>
    invoke<void>("save_project_context", { projectId, content }),
  projectOverview: (projectId: string) => invoke<ProjectOverview>("project_overview", { projectId }),
  threadContext: (threadId: string) => invoke<ContextBundle | null>("thread_context", { threadId }),
  /** Models per provider, read from the installed CLIs (cached 10 min server-side). */
  listModels: (refresh = false) => invoke<ProviderCatalog[]>("list_models", { refresh }),
  /** Native folder picker; resolves to null when cancelled. */
  pickDirectory: async (defaultPath?: string): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
    return typeof picked === "string" ? picked : null;
  },

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
