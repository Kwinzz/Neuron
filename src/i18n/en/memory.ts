import type { Translation } from "../catalog";
import type fr from "../fr/memory";

/** Namespace « memory » — English (same keys as French). */
const memory: Translation<typeof fr> = {
  // categories
  catProfile: "Profile",
  catProfileShort: "Profile",
  catProfileDescription: "Who you are, your context, how you work.",
  catProfileExample: "Full-stack developer, I speak English, concise answers.",
  catTech: "Tech preferences",
  catTechShort: "Tech prefs",
  catTechDescription: "Languages, tools and libraries you prefer.",
  catTechExample: "Prefer pnpm over npm; strict TypeScript everywhere.",
  catCodeStyle: "Code style",
  catCodeStyleShort: "Code style",
  catCodeStyleDescription: "Naming, formatting and structure conventions.",
  catCodeStyleExample: "Functional components, one component per file.",
  catStrict: "Strict rules",
  catStrictShort: "Strict rules",
  catStrictDescription: "Things agents must always do or never do.",
  catStrictExample: "Never push to main unless asked.",
  catOther: "Other",
  catOtherShort: "Other",
  catOtherDescription: "Everything else.",
  catOtherExample: "My editor is VS Code.",

  // Shared: counts and keys
  count: (v) => `${v.count} ${Number(v.n) === 1 ? "memory" : "memories"}`,
  keyEnter: "Enter",
  keyShift: "Shift",
  keyEscape: "Esc",
  import: "Import",
  newMemory: "New memory",

  // importOrigins
  originOther: "Other",
  webExportPrompt: "List every memory you have about me, one per line, without any comment.",
  sizeBytes: "{n} B",
  sizeKb: "{n} KB",
  sizeMb: "{n} MB",

  // CategoryPicker
  categoryAria: "Category: {label}",

  // CopyPromptHint
  copyPromptFailed: "Couldn't copy the prompt",
  askAssistant: "Ask {assistant}:",
  promptCopied: "Prompt copied",
  copyPrompt: "Copy prompt",
  thenPaste: "then paste its answer here.",

  // ImportCliSources
  readFileOfFailed: "Couldn't read the {label} file",
  filesNotFound: "Files not found",
  cliSourcesIntro: "The global instructions you gave your command-line agents on this computer.",
  fileEmpty: "Empty",
  useFile: "Use",
  fileMissing: "Not found",

  // ImportOriginPicker
  webAssistants: "Web assistants",
  cliAgents: "Command-line agents",

  // ImportPreviewRow
  importItem: "Import memory {n}",
  itemContent: "Content of memory {n}",
  emptyItemPlaceholder: "Empty memory: it won't be imported",
  alreadyInMemory: "Already in memory",
  removeItem: "Remove memory {n}",

  // ImportPreviewStep
  nothingLeft: "No memories left to import",
  nothingLeftHint: "Go back to the text to edit it, or rewrite it with AI.",
  selectAll: "Select all",
  duplicates: "{n} already in memory",

  // ImportReformulate
  rewriteWithAi: "Rewrite with AI",
  revertRaw: "Back to the raw text",
  rewriteAgentAria: "Agent that rewrites",
  notSignedIn: "not signed in",
  rewrite: "Rewrite",
  rewritingBy: "Rewriting with {agent}…",
  tooLongForRewrite: "Text too long to rewrite ({max} characters max): import it in several parts.",
  noAgentToRewrite:
    "No agent installed to rewrite: install Claude Code, Codex or Antigravity in Settings → Agents & MCP.",
  rewriteOptional: "Optional: the agent merges duplicates and rewrites each memory cleanly (a few tokens).",
  rewriteFailed: "Rewrite failed",

  // ImportSourceStep
  placeholderWeb: "Paste {assistant}'s answer here…",
  placeholderOther: "Write or paste what your agents should know about you, one memory per line…",
  placeholderCli: "Paste {assistant}'s instructions here, or load them from the “CLI files” tab…",
  readFileFailed: "Couldn't read the file",
  originLabel: "Source",
  tabPaste: "Paste",
  tabCliFiles: "CLI files",
  textToImport: "Text to import",
  openFile: "Open a file…",
  chars: "{n} characters",
  tooLongForAi: "too long for the AI rewrite",
  toContinue: "to continue",

  // MemoryCategoryCard
  emptyCategory: "No memories. E.g. “{example}”",

  // MemoryComposer
  addFailed: "Couldn't add the memory",
  newMemoryDescription: "A lasting piece of information all your agents should know.",
  newMemoryAria: "Content of the new memory",
  examplePlaceholder: "E.g. {example}",
  hintAdd: "to add",
  hintNewLine: "new line",

  // MemoryDeleteDialog
  deleted: "Memory deleted",
  deleteFailed: "Couldn't delete the memory",
  deleteTitle: "Delete this memory?",
  deleteDescription: "It will be removed from memory.md and no longer injected into new chats.",

  // MemoryHeaderCard
  openFileFailed: "Couldn't open memory.md",
  title: "Global memory",
  description:
    "Shared by all your agents: injected at the start of every new chat and available live through Neuron's MCP server.",
  openMemoryFile: "Open memory.md",

  // MemoryImportDialog
  noneFound: "No memories found in this text",
  splitFailed: "Couldn't split the text",
  agentReturnedNone: "The agent returned no memories.",
  nothingNew: "Nothing new: everything was already in memory",
  importedToast: (v) => (Number(v.n) === 1 ? `${v.count} memory imported` : `${v.count} memories imported`),
  importFailed: "Couldn't import the memories",
  importTitle: "Import memories",
  importSourceDescription:
    "Bring in what your other assistants know about you: paste their answer or an instructions file.",
  importPreviewDescription: "Review, fix and pick the memories to add to your global memory.",
  importCount: (v) => `Import ${v.count} ${Number(v.n) === 1 ? "memory" : "memories"}`,

  // MemoryRow
  saveFailed: "Couldn't save",
  editAria: "Edit memory",
  hintSave: "save",
  hintCancel: "cancel",

  // MemorySearchBar
  searchPlaceholder: "Search memory…",
  searchAria: "Search memory",
  clearSearch: "Clear search",

  // MemorySearchResults
  results: "Results",
  byRelevance: "Sorted by relevance",
  noMatch: "No memory matches “{query}”.",

  // MemorySource
  addedByYou: "Added by you",
  imported: "Imported",
  importedFrom: "Imported from {source}",
  savedBy: "Saved by {agent}",

  // MemoryView
  unavailable: "Memory unavailable",
};

export default memory;
