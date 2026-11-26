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
import type { ImportedMemory } from "@/bindings/ImportedMemory";
import type { LocalMemorySource } from "@/bindings/LocalMemorySource";
import type { Memory } from "@/bindings/Memory";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
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
import type { AccessLevel } from "@/bindings/AccessLevel";
import type { NearbyDevice } from "@/bindings/NearbyDevice";
import type { PairingCode } from "@/bindings/PairingCode";
import type { RemoteDevices } from "@/bindings/RemoteDevices";
import type { RemoteEventPayload } from "@/bindings/RemoteEventPayload";
import type { RemoteStatus } from "@/bindings/RemoteStatus";
import {
  connectedHosts,
  deviceOfProject,
  deviceOfThread,
  rememberProject,
  rememberThread,
} from "@/lib/deviceRouting";
import { STATUS } from "@/lib/status";

/** Must match `AGENT_EVENT_CHANNEL` in `src-tauri/src/agents/events.rs`. */
export const AGENT_EVENT_CHANNEL = "agent://event";
/** memory.md edited outside the app, or an agent saved a memory through MCP. */
export const MEMORY_CHANGED_CHANNEL = "memory://changed";
/** Subscription windows refreshed outside a chat turn (Antigravity `/quota`). */
export const QUOTAS_CHANGED_CHANNEL = "quotas://changed";
/** A native notification was clicked; payload = the chat it was about (or null). */
export const NOTIFICATION_CLICKED_CHANNEL = "notification://clicked";

/** An event of a paired device (`remote::REMOTE_EVENT_CHANNEL`). */
export const REMOTE_EVENT_CHANNEL = "remote://event";
/** Paired devices, connections, nearby devices or the pairing window changed. */
export const REMOTE_STATUS_CHANNEL = "remote://status";
/** A paired device's event stream fell behind: reload its lists. */
const REMOTE_RESYNC = "remote://resync";
/** A merged list never waits longer than this for a device. */
const REMOTE_LIST_TIMEOUT_MS = 4000;
const RECENT_LIMIT = 12;

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

/** A command on this device (`device` null) or on a paired host (same name and arguments, through `remote_call`). */
function call<T>(device: string | null, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!device) return invoke<T>(cmd, args);
  return invoke<T>("remote_call", { device, method: cmd, args });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Last answer of each device per list: a slow or unreachable device keeps showing what it had. */
const lastThreads = new Map<string, ThreadSummary[]>();
const lastProjects = new Map<string, ProjectSummary[]>();
const lastRunning = new Map<string, string[]>();

/** The same command on every connected host, each bounded in time; `[device, value]` pairs. */
async function fromHosts<T>(
  cache: Map<string, T>,
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<Array<[string, T]>> {
  const answers = await Promise.all(
    connectedHosts().map(async (device): Promise<[string, T] | null> => {
      try {
        const value = await withTimeout(call<T>(device, cmd, args), REMOTE_LIST_TIMEOUT_MS);
        cache.set(device, value);
        return [device, value];
      } catch {
        const last = cache.get(device);
        return last === undefined ? null : [device, last];
      }
    }),
  );
  return answers.filter((a): a is [string, T] => a !== null);
}

async function remoteThreads(limit?: number): Promise<ThreadSummary[]> {
  const lists = await fromHosts(lastThreads, "list_threads", { limit });
  for (const [device, list] of lists) for (const t of list) rememberThread(device, t.id);
  return lists.flatMap(([, list]) => list);
}

async function remoteProjects(): Promise<ProjectSummary[]> {
  const lists = await fromHosts(lastProjects, "list_projects");
  for (const [device, list] of lists) for (const p of list) rememberProject(device, p.id);
  return lists.flatMap(([, list]) => list);
}

/** Most recently updated first. */
function byRecent(a: ThreadSummary, b: ThreadSummary): number {
  return b.updatedAt - a.updatedAt;
}

/** Local attachments of a message for a chat of `device`: copied there first (their copies on that device). */
async function toDevice(device: string | null, attachments: Attachment[]): Promise<Attachment[]> {
  if (!device || attachments.length === 0) return attachments;
  return invoke<Attachment[]>("remote_upload_attachments", { device, attachments });
}

/** Files of a chat of another device (its paths), copied into a local cache so the webview can show them. */
async function fromDevice(threadId: string, attachments: Attachment[]): Promise<Attachment[]> {
  const device = deviceOfThread(threadId);
  if (!device || attachments.length === 0) return attachments;
  return invoke<Attachment[]>("remote_fetch_attachments", { device, threadId, attachments });
}

/** History of a chat of another device: its user attachments made local (fetched once, then cached). */
async function localHistory(threadId: string, items: ChatItem[]): Promise<ChatItem[]> {
  if (!deviceOfThread(threadId) || !items.some((it) => it.kind === "user" && it.attachments.length > 0)) return items;
  return Promise.all(
    items.map(async (it) =>
      it.kind === "user" && it.attachments.length > 0
        ? { ...it, attachments: await fromDevice(threadId, it.attachments).catch(() => it.attachments) }
        : it,
    ),
  );
}

function isAgentEnvelope(value: unknown): value is AgentEventEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { threadId?: unknown }).threadId === "string" &&
    typeof (value as { event?: unknown }).event === "object"
  );
}

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  /** Forward a frontend diagnostic to the backend log (never throws). */
  log: (level: "error" | "warn" | "info", message: string) =>
    invoke<void>("frontend_log", { level, message }).catch(() => undefined),

  // Accueil / dock / palette
  /** This device's snapshot, with the active / recent chats and projects of the connected devices merged in
   * (usage, quotas and providers stay this device's). */
  dashboardSnapshot: async (range?: UsageRange): Promise<DashboardSnapshot> => {
    const [local, threads, projects] = await Promise.all([
      invoke<DashboardSnapshot>("dashboard_snapshot", { range }),
      remoteThreads(RECENT_LIMIT),
      remoteProjects(),
    ]);
    if (threads.length === 0 && projects.length === 0) return local;
    const active = threads.filter((t) => STATUS[t.status].active);
    return {
      ...local,
      activeThreads: [...local.activeThreads, ...active].sort(byRecent),
      recentThreads: [...local.recentThreads, ...threads].sort(byRecent).slice(0, RECENT_LIMIT),
      projects: [...local.projects, ...projects],
    };
  },
  usageReport: (range: UsageRange) => invoke<UsageReport>("usage_report", { range }),
  /** Ask the agents for fresh subscription windows (throttled; the answer arrives as `quotas://changed`). */
  refreshQuotas: () => invoke<void>("refresh_quotas"),
  updateProvider: (update: ProviderUpdate) => invoke<ProviderUsage>("update_provider", { update }),
  /** Projects of this device, then of the connected devices. */
  listProjects: async (): Promise<ProjectSummary[]> => {
    const [local, remote] = await Promise.all([invoke<ProjectSummary[]>("list_projects"), remoteProjects()]);
    return remote.length === 0 ? local : [...local, ...remote];
  },
  /** Chats of every connected device, most recent first. */
  listThreads: async (limit?: number): Promise<ThreadSummary[]> => {
    const [local, remote] = await Promise.all([invoke<ThreadSummary[]>("list_threads", { limit }), remoteThreads(limit)]);
    if (remote.length === 0) return local;
    const merged = [...local, ...remote].sort(byRecent);
    return limit === undefined ? merged : merged.slice(0, limit);
  },
  getThread: (id: string) => call<ThreadSummary>(deviceOfThread(id), "get_thread", { id }),

  // Threads & chat
  /** On this device, or on `device` (a project's chats are created on the project's device). */
  createThread: async (input: NewThreadInput, device: string | null = deviceOfProject(input.projectId)) => {
    const attachments = await toDevice(device, input.attachments);
    const chat = await call<ThreadSummary>(device, "create_thread", { input: { ...input, attachments } });
    rememberThread(device, chat.id);
    return chat;
  },
  sendMessage: async (threadId: string, text: string, attachments: Attachment[] = []) => {
    const device = deviceOfThread(threadId);
    return call<void>(device, "send_message", { threadId, text, attachments: await toDevice(device, attachments) });
  },
  /** Slash commands of a provider in a folder (« / » menu; cached 15 min server-side). */
  listSlashCommands: (agent: AgentKind, cwd: string | null, device: string | null = null) =>
    call<SlashCommand[]>(device, "list_slash_commands", { agent, cwd }),
  /** Existing image files among the paths an agent mentioned in a chat (served to the webview). */
  agentImages: (threadId: string, paths: string[]) =>
    call<Attachment[]>(deviceOfThread(threadId), "agent_images", { threadId, paths }).then((found) =>
      fromDevice(threadId, found),
    ),
  /** Copy files into Neuron's attachments folder (« + » button). */
  importAttachments: (paths: string[]) => invoke<Attachment[]>("import_attachments", { paths }),
  /** Save a pasted image (base64 without the data: prefix). */
  /** On `device` when the message goes to a chat of another device (the attachment must live there). */
  pasteAttachment: (name: string, mime: string, data: string, device: string | null = null) =>
    call<Attachment>(device, "paste_attachment", { name, mime, data }),
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
  ) => call<void>(deviceOfThread(threadId), "respond_permission", { threadId, requestId, allow, mode, answers }),
  stopThread: (threadId: string) => call<void>(deviceOfThread(threadId), "stop_thread", { threadId }),
  threadHistory: async (threadId: string) =>
    localHistory(threadId, await call<ChatItem[]>(deviceOfThread(threadId), "get_thread_history", { threadId })),
  renameThread: (threadId: string, title: string) =>
    call<void>(deviceOfThread(threadId), "rename_thread", { threadId, title }),
  deleteThread: (threadId: string) => call<void>(deviceOfThread(threadId), "delete_thread", { threadId }),
  /** Running chats of every connected device. */
  runningThreads: async (): Promise<string[]> => {
    const [local, remote] = await Promise.all([invoke<string[]>("running_threads"), fromHosts(lastRunning, "running_threads")]);
    for (const [device, ids] of remote) for (const id of ids) rememberThread(device, id);
    return [...local, ...remote.flatMap(([, ids]) => ids)];
  },
  promptHistory: (projectId?: string | null) =>
    call<string[]>(deviceOfProject(projectId), "prompt_history", { projectId: projectId ?? null }),
  /** Folder a chat without project starts in, on this device or on `device`. */
  defaultCwd: (device: string | null = null) => call<string>(device, "default_cwd"),
  updateThreadSettings: (threadId: string, settings: ThreadSettingsInput) =>
    call<ThreadSummary>(deviceOfThread(threadId), "update_thread_settings", { threadId, settings }),
  createProject: (path: string, name?: string) =>
    invoke<ProjectSummary[]>("create_project", { path, name: name ?? null }),
  deleteProject: (projectId: string) => call<ProjectSummary[]>(deviceOfProject(projectId), "delete_project", { projectId }),
  // Project context (.neuron/context.md) & injected context
  projectContext: (projectId: string) =>
    call<ProjectContextFile>(deviceOfProject(projectId), "project_context", { projectId }),
  saveProjectContext: (projectId: string, content: string) =>
    call<void>(deviceOfProject(projectId), "save_project_context", { projectId, content }),
  projectOverview: (projectId: string) =>
    call<ProjectOverview>(deviceOfProject(projectId), "project_overview", { projectId }),
  threadContext: (threadId: string) => call<ContextBundle | null>(deviceOfThread(threadId), "thread_context", { threadId }),
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
  /** Open a folder (project, chat working directory) in the system file manager. */
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  memoryImportSources: () => invoke<LocalMemorySource[]>("memory_import_sources"),
  readMemoryImportFile: (path: string) => invoke<string>("read_memory_import_file", { path }),
  splitMemoryImport: (text: string) => invoke<ImportedMemory[]>("split_memory_import", { text }),
  reformulateMemoryImport: (agent: AgentKind, text: string) =>
    invoke<ImportedMemory[]>("reformulate_memory_import", { agent, text }),
  importMemories: (items: ImportedMemory[], origin: MemoryImportOrigin) =>
    invoke<number>("import_memories", { items, origin }),
  /** One text file to import (memory export), or null when cancelled. */
  pickImportFile: async (): Promise<string | null> => {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Texte", extensions: ["txt", "md", "json"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
  antigravityMcpStatus: () => invoke<AgyMcpStatus>("antigravity_mcp_status"),
  connectAntigravityMcp: () => invoke<AgyMcpStatus>("connect_antigravity_mcp"),
  disconnectAntigravityMcp: () => invoke<AgyMcpStatus>("disconnect_antigravity_mcp"),
  /** Models per provider, read from the installed CLIs (cached 10 min server-side). */
  /** Models of the CLIs installed on this device, or on `device`. */
  listModels: (refresh = false, device: string | null = null) =>
    call<ProviderCatalog[]>(device, "list_models", { refresh }),
  /** Installed / signed-in state of the CLIs on this device, or on `device`. */
  agentAccess: (refresh = false, device: string | null = null) =>
    call<AgentAccess[]>(device, "agent_access", { refresh }),
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
  /** This device's agent events and those of the connected devices (their chats are then routed to them). */
  onAgentEvent: async (handler: (payload: AgentEventEnvelope) => void): Promise<UnlistenFn> => {
    const local = await listen<AgentEventEnvelope>(AGENT_EVENT_CHANNEL, (e) => handler(e.payload));
    const remote = await listen<RemoteEventPayload>(REMOTE_EVENT_CHANNEL, (e) => {
      const { device, channel, payload } = e.payload;
      if (channel !== AGENT_EVENT_CHANNEL || !isAgentEnvelope(payload)) return;
      rememberThread(device, payload.threadId);
      const { event } = payload;
      // A message with files typed on that device: show local copies (the sender's own bubble keeps its copies).
      if (event.kind === "UserMessage" && event.attachments.length > 0) {
        void fromDevice(payload.threadId, event.attachments)
          .catch(() => event.attachments)
          .then((attachments) => handler({ ...payload, event: { ...event, attachments } }));
        return;
      }
      handler(payload);
    });
    return () => {
      local();
      remote();
    };
  },
  /** Paired devices or their connections changed, or a device asks to reload its lists. */
  onRemoteChanged: async (handler: () => void): Promise<UnlistenFn> => {
    const status = await listen(REMOTE_STATUS_CHANNEL, () => handler());
    const resync = await listen<RemoteEventPayload>(REMOTE_EVENT_CHANNEL, (e) => {
      if (e.payload.channel === REMOTE_RESYNC) handler();
    });
    return () => {
      status();
      resync();
    };
  },
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

/** Other devices: this one's access settings, pairing, paired devices. */
export const remote = {
  status: () => invoke<RemoteStatus>("remote_status"),
  /** Allow (or not) other devices to pair with and control this one. */
  setEnabled: (enabled: boolean) => invoke<RemoteStatus>("remote_set_enabled", { enabled }),
  setDeviceName: (name: string) => invoke<RemoteStatus>("remote_set_device_name", { name }),
  /** Reach / be reached by paired devices outside the local network (public relays; pairing there = invitation). */
  setInternet: (enabled: boolean) => invoke<RemoteStatus>("remote_set_internet", { enabled }),
  /** Opens a pairing window here: the 6-digit code to type on the other device (2 min, 3 attempts). */
  startPairing: () => invoke<PairingCode>("remote_start_pairing"),
  cancelPairing: () => invoke<void>("remote_cancel_pairing"),
  /** Neuron instances accepting connections on the local network. */
  nearby: () => invoke<NearbyDevice[]>("remote_nearby"),
  /** Pairs with a nearby device showing `code`; resolves to its name. */
  pair: (nodeId: string, code: string) => invoke<string>("remote_pair", { nodeId, code }),
  /** Pairs with a device anywhere from its invitation (`neuron-pair:<id>:<code>`); needs internet mode here. */
  pairInvite: (invite: string) => invoke<string>("remote_pair_invite", { invite }),
  devices: () => invoke<RemoteDevices>("remote_devices"),
  setLevel: (nodeId: string, level: AccessLevel) => invoke<void>("remote_set_level", { nodeId, level }),
  /** A device that controls this one loses access right away. */
  revoke: (nodeId: string) => invoke<void>("remote_revoke", { nodeId }),
  /** Stop controlling a device. */
  forget: (nodeId: string) => invoke<void>("remote_forget", { nodeId }),
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
