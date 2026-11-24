/**
 * The ONLY module allowed to call Tauri `invoke` / `listen`.
 * Every command and event is typed with bindings generated from Rust (`src/bindings`, via ts-rs).
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import type { AgentAccess } from "@/bindings/AgentAccess";
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
/** A native notification was clicked; payload = the chat it was about (or null). */
export const NOTIFICATION_CLICKED_CHANNEL = "notification://clicked";

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
  /** Existing image files among the paths an agent mentioned in a chat (served to the webview). */
  agentImages: (threadId: string, paths: string[]) =>
    invoke<Attachment[]>("agent_images", { threadId, paths }),
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
  agentAccess: (refresh = false) => invoke<AgentAccess[]>("agent_access", { refresh }),
  checkAgentAccess: (agent: AgentKind) => invoke<AgentAccess>("check_agent_access", { agent }),
  installAgent: (agent: AgentKind) => invoke<void>("install_agent", { agent }),
  loginAgent: (agent: AgentKind) => invoke<void>("login_agent", { agent }),
  /** Native folder picker; resolves to null when cancelled. */
  pickDirectory: async (defaultPath?: string): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
    return typeof picked === "string" ? picked : null;
  },
} as const;

export const events = {
  /** Subscribe to every normalized agent event. Returns the unsubscribe function. */
  onAgentEvent: (handler: (payload: AgentEventEnvelope) => void): Promise<UnlistenFn> =>
    listen<AgentEventEnvelope>(AGENT_EVENT_CHANNEL, (e) => handler(e.payload)),
  onMemoryChanged: (handler: () => void): Promise<UnlistenFn> => listen(MEMORY_CHANGED_CHANNEL, () => handler()),
  onQuotasChanged: (handler: () => void): Promise<UnlistenFn> => listen(QUOTAS_CHANGED_CHANNEL, () => handler()),
  /** Usage imported from the Claude Code / Codex logs. */
  onUsageChanged: (handler: () => void): Promise<UnlistenFn> => listen("usage://changed", () => handler()),
  onNotificationClicked: (handler: (threadId: string | null) => void): Promise<UnlistenFn> =>
    listen<string | null>(NOTIFICATION_CLICKED_CHANNEL, (e) => handler(e.payload)),
  /** The quick prompt asks for the « Nouveau chat » screen (payload = project id or null). */
  onNewChatRequested: (handler: (projectId: string | null) => void): Promise<UnlistenFn> =>
    listen<string | null>("quick://new-chat", (e) => handler(e.payload)),
} as const;

/** Label of the webview this code runs in: "main" (the app) or "quick" (global quick prompt). */
export const windowLabel = (): string => (isTauri() ? getCurrentWindow().label : "main");

/** Quick prompt window (global shortcut, see `desktop.rs`). */
export const quickWindow = {
  hide: (): Promise<void> => getCurrentWindow().hide(),
  /** Each time the global shortcut shows the window. */
  onOpened: (handler: () => void): Promise<UnlistenFn> => listen("quick://opened", () => handler()),
  /** Show Neuron's main window on a chat. */
  showThread: (threadId: string): Promise<void> => invoke<void>("show_thread", { threadId }),
  /** Show Neuron's main window on the « Nouveau chat » screen (in a project or not). */
  showNewChat: (projectId: string | null): Promise<void> => invoke<void>("show_new_chat", { projectId }),
};

/** Custom title bar: the native one is hidden (`decorations: false`). */
export const appWindow = {
  minimize: (): Promise<void> => getCurrentWindow().minimize(),
  toggleMaximize: (): Promise<void> => getCurrentWindow().toggleMaximize(),
  close: (): Promise<void> => getCurrentWindow().close(),
  isMaximized: (): Promise<boolean> => getCurrentWindow().isMaximized(),
  /** Fires on every resize (maximize / restore included). */
  onResized: (handler: () => void): Promise<UnlistenFn> => getCurrentWindow().onResized(() => handler()),
};

/** Native desktop notifications (asks the OS permission once). */
export const notify = {
  ensurePermission: async (): Promise<boolean> => {
    if (!isTauri()) return false;
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  },
  /** Sent by the backend under Neuron's own name and icon (Windows otherwise shows PowerShell's). */
  send: (title: string, body: string, threadId: string | null = null): void => {
    if (!isTauri()) return;
    invoke<void>("send_notification", { title, body, threadId }).catch((err: unknown) =>
      console.warn("notification failed", err),
    );
  },
};

/** URL of a local file (attachment thumbnails) through Tauri's asset protocol, scoped to the attachments folder. */
export function assetUrl(path: string): string {
  return isTauri() ? convertFileSrc(path) : path;
}
