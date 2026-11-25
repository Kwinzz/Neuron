import type { Translation } from "../catalog";
import type fr from "../fr/chat";

/** Namespace « chat » — English (same keys as French). */
const chat: Translation<typeof fr> = {
  // ChatView
  historyLoadError: "Couldn't load the history",
  emptyTitle: "New conversation",
  emptyHint: "Send a first message to start the agent.",
  // TimelineSkeleton
  historyLoading: "Loading history",

  // DraftChat
  newChat: "New chat",
  inProject: "In project",
  draftHint: "Pick the model (Claude, Codex, Antigravity…) and the reasoning level, then write your first message.",
  draftPlaceholder: "What should the agent do? (Enter to start the chat)",
  folderButton: "Folder…",
  pickWorkDir: "Choose the working folder",
  folderUnavailable: "Folder unavailable",
  startChatFailed: "Couldn't start the chat",

  // Composer
  composerPlaceholder: "Ask the agent something… (Enter to send, Shift+Enter for a new line, ↑ history)",
  attachFiles: "Attach files",
  attachFilesHint: "Attach files (or paste an image)",
  attachmentRejected: "Attachment rejected",
  pickFailed: "Couldn't pick files",
  stopAgent: "Stop the agent",
  stop: "Stop",
  send: "Send",
  // NewMessagesPill
  newMessages: "New messages",

  // ThreadHeader
  renameFailed: "Couldn't rename",
  chatName: "Chat name",
  rename: "Rename",
  chatActions: "Chat actions",
  deleteChat: "Delete chat",
  deleteChatTitle: "Delete this chat?",
  deleteChatDescription:
    "“{title}” and its whole history will be permanently deleted. Tokens and costs already counted stay in the dashboard.",
  deleteChatFailed: "Chat not deleted",
  chatDeleted: "Chat deleted",
  defaultModel: "default model",
  tokens: "{n} tokens",
  openProject: "View project",
  openFolderOf: "Open folder {path}",
  // HeaderUsage / UsageDetails
  usageButton: "Usage and quotas",
  usageThisChat: "This chat",
  usageTokens: "Tokens",
  usageCost: "Cost",
  usageSubscription: "{agent} subscription",
  usageResetIn: "Resets in {time}",
  usageUpdated: "Updated {time}",
  // TurnMarker
  requestTotalTime: "Total request time",

  // Subscription quotas
  quota5h: "5-hour quota",
  quotaWeekly: "Weekly quota",
  quota30d: "30-day quota",
  subscriptionQuotas: "Subscription quotas",

  // ErrorItem
  agentReady: "{agent} is ready: send your message again.",
  agentNotInstalled: "{agent} isn't installed",
  agentSignedOut: "{agent} isn't signed in to your account",
  terminalInstaller: "A terminal opens with the official installer.",
  terminalLogin: "A terminal opens to sign in.",
  // AgentAccessNotice (after the agent's name)
  noticeNotInstalled: "isn't installed on this computer.",
  noticeSignedOut: "isn't signed in to your account: the agent won't be able to answer.",

  // PermissionCard
  permissionRequired: "Permission required — {tool}",
  allow: "Allow",
  deny: "Deny",
  allowed: "Allowed",
  denied: "Denied",
  kbdEnter: "Enter",
  kbdEscape: "Esc",
  allowHint: "allow",
  denyHint: "deny",

  // PlanApproval
  planApproval: "Plan approval",
  runThisPlan: "Run this plan?",
  runAcceptEdits: "Run with auto-edit",
  runAuto: "Run in auto",
  runManual: "Run, asking first",
  keepPlanning: "Keep planning",
  planApproved: "Plan approved",
  planRunningIn: " · running in {mode}",
  planContinued: "Still planning: say what should change.",
  // PlanFollowUp
  planModeHint: "Plan mode: the agent didn't change anything. Reply to adjust the plan, or run it.",
  runPlan: "Run the plan",
  runPlanPrompt: "Carry out the plan above.",
  runPlanFailed: "Couldn't run the plan",
  // PlanBlock / Timeline (Markdown documents)
  planBadge: "Plan",
  emptyPlan: "_Empty plan._",
  planDropped: "not kept",
  updated: "updated",

  // QuestionCard
  agentQuestions: "Agent questions",
  agentHasQuestions: "The agent has some questions",
  agentHasQuestion: "The agent has a question",
  multipleChoices: "pick one or more",
  singleChoice: "pick one",
  otherOption: "Other…",
  otherOptionHint: "Write my own answer",
  answerPlaceholder: "Your answer…",
  freeAnswer: "Free answer: {question}",
  answer: "Answer",
  skip: "Skip",
  // QuestionSummary
  questionsSkipped: "Questions skipped",
  yourAnswers: "Your answers",
  yourAnswer: "Your answer",

  // ThinkingBlock
  thinking: "Thinking",
  // ToolBlock / ToolBody
  toolRunning: "Running",
  toolDone: "Done",
  output: "Output",
  // OutputBlock / DiffView / UnifiedDiff
  outputTruncated: "(output truncated)",
  collapse: "Collapse",
  showAll: "Show all",
  showAllLines: "Show all ({n} lines)",
  unchangedLines: (v) => (Number(v.n) === 1 ? `${v.n} unchanged line` : `${v.n} unchanged lines`),
  diffTruncated: "Diff truncated (heavily changed file).",
  // FileEditBlock
  fileAdded: "New file",
  fileDeleted: "Deleted",
  // MarkdownFileCard
  display: "Display",
  preview: "Preview",
  source: "Source",
  copyMarkdown: "Copy Markdown",
  copyFailed: "Couldn't copy",
  // CommandOutput
  commandResult: "command output",
  percent: "{n}%",
  // UserMessage (« Used the /usage command »)
  commandUsedPrefix: "Used the",
  commandUsedSuffix: "command",

  // ChatSettingsBar
  reasoningLevel: "Reasoning level",
  reasoning: "Reasoning",
  byDefault: "Default",
  planModeActiveNote: "Plan mode is on: this applies when you switch back to Run.",
  // ThreadSettingsBar
  settingNotApplied: "Setting not applied",
  // ModeSwitch
  agentMode: "Agent mode",
  modeRun: "Run",
  modePlan: "Plan",
  modeRunHint: "The agent acts within the chosen permissions",
  modePlanHint: "Plan mode: the agent proposes a plan without changing anything",
  modeSwitchTitle: "{hint} (Shift+Tab)",
  // ModelPicker
  model: "Model",
  agentDefault: "{agent} · default",
  searchModel: "Search models…",
  loadingModels: "Loading models…",
  noModel: "No models",
  notInstalled: "not installed",
  newChatRequired: "new chat required",
  defaultSearchWord: "default",
  defaultModelItem: "Default model",
  reasoningLevels: "{n} reasoning levels",
  changeProviderNewChat: "Changing provider = new chat",
  allProviders: "All providers",
  refresh: "Refresh",
  // SlashMenu
  commandsFor: "Commands · {provider}",
  slashNavigate: "navigate",
  slashInsert: "insert",
  slashClose: "close",
  slashCommands: "Slash commands",
  noCommandsFor: "No commands available for {provider}",
  noMatchingCommand: "No matching command",

  // Markdown (document mode: annotation under empty template headings)
  emptySection: "Empty section",

  // Attachments
  attachments: "Attachments",
  removeAttachment: "Remove {name}",
  importingOne: "Importing a file…",
  importingMany: "Importing {n} files…",
  enlargeImage: "Enlarge {name}",
  previousImage: "Previous image",
  nextImage: "Next image",
  fileGeneric: "File",
  unitB: "B",
  unitKB: "KB",
  unitMB: "MB",
  unitGB: "GB",

  // Chat store toasts
  answerFailed: "Couldn't send the answer",
  stopFailed: "Couldn't stop the agent",
};

export default chat;
