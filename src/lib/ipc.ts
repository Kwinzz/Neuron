/**
 * The ONLY module allowed to call Tauri `invoke` / `listen`.
 * Every command and event is typed with bindings generated from Rust (`src/bindings`, via ts-rs).
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AgentEventEnvelope } from "@/bindings/AgentEventEnvelope";
import type { AppInfo } from "@/bindings/AppInfo";
import type { ChatItem } from "@/bindings/ChatItem";
import type { AgyMcpStatus } from "@/bindings/AgyMcpStatus";
import type { AppSettings } from "@/bindings/AppSettings";
import type { Attachment } from "@/bindings/Attachment";
import type { AgentKind } from "@/bindings/AgentKind";
import type { SlashCommand } from "@/bindings/SlashCommand";
import type { PricingStatus } from "@/bindings/PricingStatus";
import type { GenericCliProfile } from "@/bindings/GenericCliProfile";
import type { GenericCliTest } from "@/bindings/GenericCliTest";
import type { ContextBundle } from "@/bindings/ContextBundle";
import type { Memory } from "@/bindings/Memory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import type { MemoryHit } from "@/bindings/MemoryHit";
import type { MemoryInfo } from "@/bindings/MemoryInfo";
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
/** memory.md edited outside the app, or an agent saved a memory through MCP. */
export const MEMORY_CHANGED_CHANNEL = "memory://changed";
/** Subscription windows refreshed outside a chat turn (Antigravity `/quota`). */
export const QUOTAS_CHANGED_CHANNEL = "quotas://changed";

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
  sendMessage: (threadId: string, text: string, attachments: Attachment[] = []) =>
    invoke<void>("send_message", { threadId, text, attachments }),
  /** Slash commands of a provider in a folder (« / » menu; cached 15 min server-side). */
  listSlashCommands: (agent: AgentKind, cwd: string | null) =>
    invoke<SlashCommand[]>("list_slash_commands", { agent, cwd }),
  /** Copy files into Neuron's attachments folder (« + » button). */
  importAttachments: (paths: string[]) => invoke<Attachment[]>("import_attachments", { paths }),
  /** Save a pasted image (base64 without the data: prefix). */
  pasteAttachment: (name: string, mime: string, data: string) =>
    invoke<Attachment>("paste_attachment", { name, mime, data }),
  /** Native file picker (several files); resolves to [] when cancelled. */
  pickFiles: async (): Promise<string[]> => {
    const picked = await openDialog({ multiple: true, directory: false });
    if (Array.isArray(picked)) return picked;
    return typeof picked === "string" ? [picked] : [];
  },
  /** `mode`: approving a plan also picks the mode to run it in (refusing with a mode = keep planning). */
  respondPermission: (
    threadId: string,
    requestId: string,
    allow: boolean,
    mode: string | null = null,
    /** Replies to Claude's AskUserQuestion: question → answer. */
    answers: Record<string, string> | null = null,
  ) => invoke<void>("respond_permission", { threadId, requestId, allow, mode, answers }),
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
  // Paramètres
  getAppSettings: () => invoke<AppSettings>("get_app_settings"),
  updateAppSettings: (settings: AppSettings) => invoke<AppSettings>("update_app_settings", { settings }),
  testGenericCli: (profile: GenericCliProfile) => invoke<GenericCliTest>("test_generic_cli", { profile }),
  pricingStatus: () => invoke<PricingStatus>("pricing_status"),
  refreshPrices: () => invoke<PricingStatus>("refresh_prices"),
  // Global memory (~/.neuron/memory.md ⇄ SQLite) & its MCP server
  listMemories: () => invoke<Memory[]>("list_memories"),
  createMemory: (category: MemoryCategory, content: string) => invoke<Memory>("create_memory", { category, content }),
  updateMemory: (id: string, category: MemoryCategory, content: string) =>
    invoke<Memory>("update_memory", { id, category, content }),
  deleteMemory: (id: string) => invoke<void>("delete_memory", { id }),
  searchMemories: (query: string, limit?: number) => invoke<MemoryHit[]>("search_memories", { query, limit }),
  memoryInfo: () => invoke<MemoryInfo>("memory_info"),
  openMemoryFile: () => invoke<void>("open_memory_file"),
  antigravityMcpStatus: () => invoke<AgyMcpStatus>("antigravity_mcp_status"),
  connectAntigravityMcp: () => invoke<AgyMcpStatus>("connect_antigravity_mcp"),
  disconnectAntigravityMcp: () => invoke<AgyMcpStatus>("disconnect_antigravity_mcp"),
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
  onMemoryChanged: (handler: () => void): Promise<UnlistenFn> => listen(MEMORY_CHANGED_CHANNEL, () => handler()),
  onQuotasChanged: (handler: () => void): Promise<UnlistenFn> => listen(QUOTAS_CHANGED_CHANNEL, () => handler()),
} as const;

/** Native desktop notifications (asks the OS permission once). */
export const notify = {
  ensurePermission: async (): Promise<boolean> => {
    if (!isTauri()) return false;
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  },
  send: (title: string, body: string): void => {
    if (isTauri()) sendNotification({ title, body });
  },
};

/** URL of a local file (attachment thumbnails) through Tauri's asset protocol, scoped to the attachments folder. */
export function assetUrl(path: string): string {
  return isTauri() ? convertFileSrc(path) : path;
}
