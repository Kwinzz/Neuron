import type { Message } from "../index";

/** Namespace « memory » — French (source of truth). */
const memory = {
  // categories
  catProfile: "Profil",
  catProfileShort: "Profil",
  catProfileDescription: "Qui tu es, ton contexte, ta façon de travailler.",
  catProfileExample: "Développeur full-stack, je parle français, réponses concises.",
  catTech: "Préférences techniques",
  catTechShort: "Préf. techniques",
  catTechDescription: "Langages, outils et bibliothèques que tu privilégies.",
  catTechExample: "Préférer pnpm à npm ; TypeScript strict partout.",
  catCodeStyle: "Style de code",
  catCodeStyleShort: "Style de code",
  catCodeStyleDescription: "Conventions de nommage, formatage, structure.",
  catCodeStyleExample: "Composants fonctionnels, un composant par fichier.",
  catStrict: "Règles strictes",
  catStrictShort: "Règles strictes",
  catStrictDescription: "Interdits et obligations que les agents doivent toujours respecter.",
  catStrictExample: "Ne jamais pousser sur main sans demande.",
  catOther: "Autres",
  catOtherShort: "Autres",
  catOtherDescription: "Tout le reste.",
  catOtherExample: "Mon éditeur est VS Code.",

  // Shared: counts and keys
  /** `count` = formatted number, `n` = raw number (for the plural). */
  count: (v) => `${v.count} ${Number(v.n) > 1 ? "souvenirs" : "souvenir"}`,
  keyEnter: "Entrée",
  keyShift: "Maj",
  keyEscape: "Échap",
  import: "Importer",
  newMemory: "Nouveau souvenir",

  // importOrigins
  originOther: "Autre",
  webExportPrompt: "Liste tous les souvenirs que tu as sur moi, un par ligne, sans commentaire.",
  sizeBytes: "{n} o",
  sizeKb: "{n} Ko",
  sizeMb: "{n} Mo",

  // CategoryPicker
  categoryAria: "Catégorie : {label}",

  // CopyPromptHint
  copyPromptFailed: "Impossible de copier la demande",
  askAssistant: "Demande à {assistant} :",
  promptCopied: "Demande copiée",
  copyPrompt: "Copier la demande",
  thenPaste: "puis colle sa réponse ici.",

  // ImportCliSources
  readFileOfFailed: "Impossible de lire le fichier de {label}",
  filesNotFound: "Fichiers introuvables",
  cliSourcesIntro:
    "Les instructions globales que tu as données à tes agents en ligne de commande sur cet ordinateur.",
  fileEmpty: "Vide",
  useFile: "Utiliser",
  fileMissing: "Introuvable",

  // ImportOriginPicker
  webAssistants: "Assistants web",
  cliAgents: "Agents en ligne de commande",

  // ImportPreviewRow
  importItem: "Importer le souvenir {n}",
  itemContent: "Contenu du souvenir {n}",
  emptyItemPlaceholder: "Souvenir vide : il ne sera pas importé",
  alreadyInMemory: "Déjà en mémoire",
  removeItem: "Retirer le souvenir {n}",

  // ImportPreviewStep
  nothingLeft: "Plus aucun souvenir à importer",
  nothingLeftHint: "Reviens au texte pour le modifier, ou reformule-le avec l'IA.",
  selectAll: "Tout sélectionner",
  duplicates: "{n} déjà en mémoire",

  // ImportReformulate
  rewriteWithAi: "Reformuler avec l'IA",
  revertRaw: "Revenir au texte brut",
  rewriteAgentAria: "Agent qui reformule",
  notSignedIn: "non connecté",
  rewrite: "Reformuler",
  rewritingBy: "Reformulation par {agent}…",
  tooLongForRewrite:
    "Texte trop long pour une reformulation ({max} caractères max) : importe-le en plusieurs fois.",
  noAgentToRewrite:
    "Aucun agent installé pour reformuler : installe Claude Code, Codex ou Antigravity dans Paramètres → Agents & MCP.",
  rewriteOptional:
    "Optionnel : l'agent fusionne les doublons et réécrit chaque souvenir proprement (quelques tokens).",
  rewriteFailed: "Reformulation impossible",

  // ImportSourceStep
  placeholderWeb: "Colle ici la réponse de {assistant}…",
  placeholderOther: "Écris ou colle ce que tes agents doivent savoir sur toi, un souvenir par ligne…",
  placeholderCli: "Colle ici les instructions de {assistant}, ou charge-les depuis l'onglet « Fichiers des CLI »…",
  readFileFailed: "Impossible de lire le fichier",
  originLabel: "Provenance",
  tabPaste: "Coller",
  tabCliFiles: "Fichiers des CLI",
  textToImport: "Texte à importer",
  openFile: "Ouvrir un fichier…",
  chars: "{n} caractères",
  tooLongForAi: "trop long pour la reformulation IA",
  toContinue: "pour continuer",

  // MemoryCategoryCard
  emptyCategory: "Aucun souvenir. Ex. : « {example} »",

  // MemoryComposer
  addFailed: "Impossible d'ajouter le souvenir",
  newMemoryDescription: "Une information durable que tous tes agents doivent connaître.",
  newMemoryAria: "Contenu du nouveau souvenir",
  examplePlaceholder: "Ex. : {example}",
  hintAdd: "pour ajouter",
  hintNewLine: "nouvelle ligne",

  // MemoryDeleteDialog
  deleted: "Souvenir supprimé",
  deleteFailed: "Impossible de supprimer le souvenir",
  deleteTitle: "Supprimer ce souvenir ?",
  deleteDescription: "Il sera retiré de memory.md et ne sera plus injecté dans les nouveaux chats.",

  // MemoryHeaderCard
  openFileFailed: "Impossible d'ouvrir memory.md",
  title: "Mémoire globale",
  description:
    "Partagée par tous tes agents : injectée au début de chaque nouveau chat et accessible en direct via le serveur MCP de Neuron.",
  openMemoryFile: "Ouvrir memory.md",

  // MemoryImportDialog
  noneFound: "Aucun souvenir trouvé dans ce texte",
  splitFailed: "Impossible de découper le texte",
  agentReturnedNone: "L'agent n'a renvoyé aucun souvenir.",
  nothingNew: "Rien de nouveau : tout était déjà en mémoire",
  /** `count` = formatted number, `n` = raw number. */
  importedToast: (v) =>
    Number(v.n) > 1 ? `${v.count} souvenirs importés` : `${v.count} souvenir importé`,
  importFailed: "Impossible d'importer les souvenirs",
  importTitle: "Importer une mémoire",
  importSourceDescription:
    "Récupère ce que tes autres assistants savent de toi : colle leur réponse ou un fichier d'instructions.",
  importPreviewDescription: "Vérifie, corrige et choisis les souvenirs à ajouter à ta mémoire globale.",
  /** `count` = formatted number, `n` = raw number. */
  importCount: (v) => `Importer ${v.count} ${Number(v.n) > 1 ? "souvenirs" : "souvenir"}`,

  // MemoryRow
  saveFailed: "Impossible d'enregistrer",
  editAria: "Modifier le souvenir",
  hintSave: "enregistrer",
  hintCancel: "annuler",

  // MemorySearchBar
  searchPlaceholder: "Rechercher dans la mémoire…",
  searchAria: "Rechercher dans la mémoire",
  clearSearch: "Effacer la recherche",

  // MemorySearchResults
  results: "Résultats",
  byRelevance: "Classés par pertinence",
  noMatch: "Aucun souvenir ne correspond à « {query} ».",

  // MemorySource
  addedByYou: "Ajouté par toi",
  imported: "Importé",
  importedFrom: "Importé de {source}",
  savedBy: "Enregistré par {agent}",

  // MemoryView
  unavailable: "Mémoire indisponible",
} satisfies Record<string, Message>;

export default memory;
