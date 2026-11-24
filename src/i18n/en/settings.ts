import type { Translation } from "../catalog";
import type fr from "../fr/settings";

/** Namespace « settings » — English (same keys as French). */
const settings: Translation<typeof fr> = {
  // SettingsView
  title: "Settings",
  subtitle: "Neuron preferences, saved automatically.",
  unavailable: "Settings unavailable",

  // SettingsNav
  navLabel: "Settings sections",
  navGeneral: "General",
  navBackground: "Background & shortcut",
  navAgents: "Agents & MCP",
  navNotifications: "Notifications",
  navContext: "Injected context",
  navGeneric: "Generic CLIs",
  navShortcuts: "Shortcuts",

  // SettingsSkeleton
  loadingLabel: "Loading settings",

  // useSettingsPatch
  saveFailed: "Couldn't save settings",

  // Shared by several sections
  inAppOnly: "Available in the app",
  test: "Test",
  minUnit: "min",

  // LanguageCard
  language: "Language",
  languageDescription: "Language of Neuron's interface.",

  // GeneralSection
  idleTitle: "Stop idle agents",
  idleDescription: "Idle processes are stopped to free memory; the chat resumes automatically on the next message.",
  idleGroupLabel: "Delay before stopping idle agents",
  idleNever: "Never",
  idlePreset: "{n} min",
  idleCustom: "Custom",
  idleNeverHint: "Agents stay active as long as Neuron is open.",
  idleAfterPrefix: "Stopped after",
  idleAfterSuffix: "min of inactivity.",

  // PricingCard
  pricingUpdated: "Prices up to date",
  pricingModels: "{n} models",
  pricingFailed: "Update failed",
  pricingTitle: "Model prices",
  pricingDescription:
    "Codex and Antigravity only report tokens: the cost of each request is estimated at the model's public API price. LiteLLM list (official OpenAI, Anthropic and Google prices), downloaded at most once a day; a new model is priced as soon as it shows up there.",
  pricingModelsUpdated: "models · updated",
  pricingBuiltin: "Built-in table (online list not downloaded yet)",
  pricingLastError: "Last attempt: {error}",
  refresh: "Refresh",

  // BackgroundSection
  keyShift: "Shift",
  keySpace: "Space",
  shortcutAria: "Quick prompt shortcut",
  shortcutRecording: "Press the key combination…",
  bgTitle: "Background",
  bgDescription:
    "Neuron stays in the notification area (near the clock): agents keep running, notifications still arrive and the quick prompt stays available.",
  closeToTray: "Keep running in the background when closed",
  closeToTrayDescription:
    "The close button hides the window instead of quitting. “Quit Neuron” in the tray icon menu stops everything.",
  launchWithWindows: "Launch with Windows",
  launchAtLogin: "Launch at login",
  launchDescriptionDev:
    "Starts Neuron quietly in the notification area when you log in (no effect in dev mode: only the installed app registers at startup).",
  launchDescription: "Starts Neuron quietly in the notification area when you log in.",
  quickTitle: "Quick prompt",
  quickDescription:
    "From any app (even in a game, in windowed fullscreen), a shortcut opens a small window to write your prompt and send it to a new chat or a recent one.",
  quickEnable: "Enable quick prompt",
  quickShortcut: "Global shortcut",
  quickShortcutLinux:
    "Click, then press the key combination. Wayland has no global shortcuts: bind the “neuron --quick” command to a shortcut of your desktop (Hyprland, KDE, GNOME…).",
  quickShortcutHint: "Click, then press the key combination (with Ctrl, Alt or Win). Esc to cancel.",
  shortcutReset: "Default shortcut",
  shortcutDefault: "Default: {shortcut}",

  // NotificationsSection
  notifTitle: "Notifications",
  notifDescription: "Only when the Neuron window isn't in the foreground.",
  notifEnable: "Enable notifications",
  notifEnableDescription: "System alerts to follow agent activity in the background",
  notifBlocked: "Notifications blocked",
  notifBlockedWindows:
    "Windows blocked Neuron's notifications. Allow them in Windows Settings › System › Notifications.",
  notifBlockedOther: "The system blocked Neuron's notifications. Allow them in your desktop's notification settings.",
  notifPermission: "Permission request",
  notifPermissionDescription: "An agent is waiting for your approval to use a tool",
  notifFinished: "Response finished",
  notifFinishedDescription: "An agent finished its response",
  notifErrorDescription: "A chat stopped on an error",
  notifTestBody: "Notifications are working.",
  notifSent: "Notification sent",

  // ContextSection
  contextTitle: "Injected context",
  contextDescription: "What is sent automatically when a new chat starts.",
  ctxMemory: "Global memory",
  ctxMemoryDescription: "Your preferences and rules saved in memory.md",
  ctxGit: "Git snapshot",
  ctxGitDescription: "Branch, status and latest commits of the project",
  ctxRecent: "Recent files",
  ctxRecentDescription: "Project files changed recently",
  ctxNewChatsOnly: "Applies to new chats only: the context is frozen when the chat is created.",
  openMemory: "Open memory",

  // ShortcutsSection
  shortcutsTitle: "Keyboard shortcuts",
  shortcutsDescription: "Ctrl stands for ⌘ on macOS.",

  // AgentsMcpCard
  toolMemoryRead: "Reads the whole memory, grouped by category.",
  toolMemorySearch: "Full-text search in memories.",
  toolMemorySave: "Saves a new lasting memory.",
  toolMemoryUpdate: "Fixes a memory (text or category).",
  toolMemoryDelete: "Removes a memory that is no longer true.",
  toolContextRead: "Reads the chat project's .neuron/context.md.",
  toolContextUpdate: "Updates the project's .neuron/context.md.",
  copyCommandFailed: "Couldn't copy the command",
  mcpTitle: "Agents & MCP",
  mcpDescription:
    "Agents read and enrich the memory live through Neuron's MCP server (status per agent in “AI providers”).",
  mcpDisabled: "MCP server disabled",
  mcpTools: "Exposed tools",
  mcpServerCommand: "Server command",
  copyCommand: "Copy command",

  // AgyMemoryLine
  agyConnected: "Antigravity connected to memory",
  agyDisconnected: "Antigravity disconnected from memory",
  agyConnectFailed: "Couldn't connect Antigravity",
  agyDisconnectFailed: "Couldn't disconnect Antigravity",
  memoryLinked: "Neuron memory connected",
  unplug: "Disconnect",
  memoryOutdated: "Memory needs reconnecting (Neuron's path changed)",
  agyMcpHint:
    "Antigravity doesn't accept an MCP server per session: Neuron registers it once in its configuration (agy mcp add neuron).",
  memoryNotLinked: "Neuron memory not connected",
  replug: "Reconnect",
  plugMemory: "Connect memory",

  // ProvidersCard
  providersTitle: "AI providers",
  providersDescription:
    "The CLIs Neuron drives. Install and sign-in open in a terminal; Neuron detects when they're done on its own.",
  recheck: "Check again",
  unknownState: "Unknown status",
  ready: "Ready",
  memoryEverySession: "Neuron memory connected in every session",
  officialCommand: "Official command: ",
  commandLabel: "Command: ",
  notInstalled: "Not installed",
  installedNotSignedIn: "Installed · not signed in",
  installedUnverifiable: "Installed · sign-in can't be checked",
  signedIn: "Signed in",
  signedInAs: "Signed in · {account}",

  // GenericClisSection
  cliDeleted: "CLI deleted",
  cliDeleteFailed: "Couldn't delete the CLI",
  genericTitle: "Generic CLIs",
  genericDescription:
    "One process per message, with no memory between messages and no permission prompts. Usable as a model in “New chat”.",
  addCli: "Add a CLI",
  genericEmpty: "No generic CLI yet. Add Ollama, Aider, Gemini CLI… to use them as a model.",

  // GenericCliEditor
  cliSaved: "CLI saved",
  cliSaveFailed: "Couldn't save the CLI",
  editCli: "Edit “{name}”",
  newCli: "New CLI",
  presets: "Presets",
  cliName: "Name",
  cliCommand: "Command",
  cliArgs: "Arguments",
  cliArgsHint: "(one per line)",
  promptReplaced: "is replaced by your message; without",
  promptStdin: ", the message is sent on standard input.",
  pty: "Pseudo-terminal",
  ptyDescription: "For tools that require a real terminal; color codes are stripped.",
  preview: "Preview",

  // GenericCliCommandPreview
  commandPlaceholder: "command…",
  stdinHint: "← message on stdin",

  // GenericCliDeleteDialog
  deleteCliTitle: "Delete this CLI?",
  deleteCliDescription: "Existing chats that use it won't be able to send messages anymore.",

  // GenericCliTestResult
  testReceivedIn: "Response received in",
  testFailed: "Test failed",
  closeTestResult: "Close test result",
  noOutput: "(no output)",

  // AgentAccessButton
  installing: "Installing…",
  signingIn: "Signing in…",
  stopWaiting: "Stop waiting",
  installAgent: "Install {agent}",
  signInAgent: "Sign in to {agent}",
  install: "Install",
  signIn: "Sign in",

  // stores/access
  installFailed: "Install failed",
  signInFailed: "Sign-in failed",
  agentInstalled: "{agent} is installed",
  signInRemaining: "You still need to sign in to your account.",
  agentSignedIn: "{agent} is signed in",
};

export default settings;
