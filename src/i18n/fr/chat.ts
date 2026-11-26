import type { Message } from "../index";

/** Namespace « chat » — French (source of truth). */
const chat = {
  // ChatView
  historyLoadError: "Impossible de charger l'historique",
  emptyTitle: "Nouvelle conversation",
  emptyHint: "Envoyez un premier message pour démarrer l'agent.",
  // TimelineSkeleton
  historyLoading: "Chargement de l'historique",

  // DraftChat
  newChat: "Nouveau chat",
  inProject: "Dans le projet",
  draftHint:
    "Choisis le modèle (Claude, Codex, Antigravity…) et le niveau de raisonnement, puis écris ton premier message.",
  draftPlaceholder: "Que doit faire l'agent ? (Entrée pour démarrer le chat)",
  folderButton: "Dossier…",
  pickWorkDir: "Choisir le dossier de travail",
  remoteDefaultFolder: "Dossier par défaut de {device}",
  folderUnavailable: "Dossier inaccessible",
  startChatFailed: "Impossible de démarrer le chat",
  thisPc: "Ce PC",
  runOn: "Exécuter sur : {device}",
  runOnLabel: "Exécuter sur",

  // Composer
  composerPlaceholder:
    "Demandez quelque chose à l'agent… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne, ↑ historique)",
  attachFiles: "Joindre des fichiers",
  attachFilesHint: "Joindre des fichiers (ou coller une image)",
  attachmentRejected: "Pièce jointe refusée",
  pickFailed: "Sélection impossible",
  stopAgent: "Arrêter l'agent",
  stop: "Arrêter",
  send: "Envoyer",
  // NewMessagesPill
  newMessages: "Nouveaux messages",

  // ThreadHeader
  renameFailed: "Renommage impossible",
  chatName: "Nom du chat",
  rename: "Renommer",
  chatActions: "Actions du chat",
  deleteChat: "Supprimer le chat",
  deleteChatTitle: "Supprimer ce chat ?",
  deleteChatDescription:
    "« {title} » et tout son historique seront supprimés définitivement. Les tokens et coûts déjà comptés restent dans le tableau de bord.",
  deleteChatFailed: "Chat non supprimé",
  chatDeleted: "Chat supprimé",
  defaultModel: "modèle par défaut",
  tokens: "{n} tokens",
  openProject: "Voir le projet",
  openFolderOf: "Ouvrir le dossier {path}",
  // HeaderUsage / UsageDetails
  usageButton: "Consommation et quotas",
  usageThisChat: "Ce chat",
  usageTokens: "Tokens",
  usageCost: "Coût",
  usageSubscription: "Abonnement {agent}",
  usageResetIn: "Reset dans {time}",
  usageUpdated: "Mis à jour {time}",
  // TurnMarker
  requestTotalTime: "Temps total de la requête",

  // Subscription quotas
  quota5h: "Quota 5 h",
  quotaWeekly: "Quota hebdomadaire",
  quota30d: "Quota 30 jours",
  subscriptionQuotas: "Quotas de l'abonnement",

  // ErrorItem
  agentReady: "{agent} est prêt : renvoie ton message.",
  agentNotInstalled: "{agent} n'est pas installé",
  agentSignedOut: "{agent} n'est pas connecté à ton compte",
  terminalInstaller: "Un terminal s'ouvre avec l'installateur officiel.",
  terminalLogin: "Un terminal s'ouvre pour la connexion.",
  // AgentAccessNotice (after the agent's name)
  noticeNotInstalled: "n'est pas installé sur cet ordinateur.",
  noticeSignedOut: "n'est pas connecté à ton compte : l'agent ne pourra pas répondre.",

  // PermissionCard
  permissionRequired: "Autorisation requise — {tool}",
  allow: "Autoriser",
  deny: "Refuser",
  allowed: "Autorisé",
  denied: "Refusé",
  kbdEnter: "Entrée",
  kbdEscape: "Échap",
  allowHint: "autoriser",
  denyHint: "refuser",

  // PlanApproval
  planApproval: "Approbation du plan",
  runThisPlan: "Exécuter ce plan ?",
  runAcceptEdits: "Exécuter en éditions auto",
  runAuto: "Exécuter en auto",
  runManual: "Exécuter en demandant",
  keepPlanning: "Continuer à planifier",
  planApproved: "Plan approuvé",
  /** Appended to planApproved; `{mode}` = permission mode label, lowercased. */
  planRunningIn: " · exécution en {mode}",
  planContinued: "Planification poursuivie : précise ce qu'il faut changer.",
  // PlanFollowUp
  planModeHint: "Mode Plan : l'agent n'a rien modifié. Réponds pour ajuster le plan, ou lance-le.",
  runPlan: "Exécuter le plan",
  /** Message sent to the agent. */
  runPlanPrompt: "Exécute le plan ci-dessus.",
  runPlanFailed: "Impossible de lancer le plan",
  // PlanBlock / Timeline (Markdown documents)
  planBadge: "Plan",
  emptyPlan: "_Plan vide._",
  planDropped: "non retenu",
  updated: "mis à jour",

  // QuestionCard
  agentQuestions: "Questions de l'agent",
  agentHasQuestions: "L'agent a des questions",
  agentHasQuestion: "L'agent a une question",
  multipleChoices: "plusieurs choix possibles",
  singleChoice: "un seul choix",
  otherOption: "Autre…",
  otherOptionHint: "Écrire ma propre réponse",
  answerPlaceholder: "Ta réponse…",
  freeAnswer: "Réponse libre : {question}",
  answer: "Répondre",
  skip: "Ignorer",
  // QuestionSummary
  questionsSkipped: "Questions ignorées",
  yourAnswers: "Tes réponses",
  yourAnswer: "Ta réponse",

  // ThinkingBlock
  thinking: "Réflexion",
  // ToolBlock / ToolBody
  toolRunning: "En cours",
  toolDone: "Terminé",
  output: "Sortie",
  // OutputBlock / DiffView / UnifiedDiff
  outputTruncated: "(sortie tronquée)",
  collapse: "Réduire",
  showAll: "Afficher tout",
  showAllLines: "Afficher tout ({n} lignes)",
  unchangedLines: (v) => (Number(v.n) > 1 ? `${v.n} lignes inchangées` : `${v.n} ligne inchangée`),
  diffTruncated: "Diff tronqué (fichier très modifié).",
  // FileEditBlock
  fileAdded: "Nouveau fichier",
  fileDeleted: "Supprimé",
  // MarkdownFileCard
  display: "Affichage",
  preview: "Aperçu",
  source: "Source",
  copyMarkdown: "Copier le Markdown",
  copyFailed: "Copie impossible",
  // CommandOutput
  commandResult: "résultat de la commande",
  percent: "{n} %",
  // UserMessage (« Commande /usage utilisée »)
  commandUsedPrefix: "Commande",
  commandUsedSuffix: "utilisée",

  // ChatSettingsBar
  reasoningLevel: "Niveau de raisonnement",
  reasoning: "Raisonnement",
  byDefault: "Par défaut",
  planModeActiveNote: "Mode Plan actif : ce choix s'applique quand tu repasses en Exécuter.",
  // ThreadSettingsBar
  settingNotApplied: "Réglage non appliqué",
  // ModeSwitch
  agentMode: "Mode de l'agent",
  modeRun: "Exécuter",
  modePlan: "Planifier",
  modeRunHint: "L'agent agit selon les permissions choisies",
  modePlanHint: "Mode Plan : l'agent propose un plan sans rien modifier",
  modeSwitchTitle: "{hint} (Maj+Tab)",
  // ModelPicker
  model: "Modèle",
  agentDefault: "{agent} · par défaut",
  searchModel: "Rechercher un modèle…",
  loadingModels: "Chargement des modèles…",
  noModel: "Aucun modèle",
  notInstalled: "non installé",
  newChatRequired: "nouveau chat requis",
  /** Search keyword of the « default model » entry. */
  defaultSearchWord: "défaut",
  defaultModelItem: "Modèle par défaut",
  reasoningLevels: "{n} niveaux de raisonnement",
  changeProviderNewChat: "Changer de fournisseur = nouveau chat",
  allProviders: "Tous fournisseurs confondus",
  refresh: "Actualiser",
  // SlashMenu
  commandsFor: "Commandes · {provider}",
  slashNavigate: "naviguer",
  slashInsert: "insérer",
  slashClose: "fermer",
  slashCommands: "Commandes slash",
  noCommandsFor: "Aucune commande disponible pour {provider}",
  noMatchingCommand: "Aucune commande ne correspond",

  // Markdown (document mode: annotation under empty template headings)
  emptySection: "Section vide",

  // Attachments
  attachments: "Pièces jointes",
  removeAttachment: "Retirer {name}",
  importingOne: "Import d’un fichier…",
  importingMany: "Import de {n} fichiers…",
  enlargeImage: "Agrandir {name}",
  previousImage: "Image précédente",
  nextImage: "Image suivante",
  fileGeneric: "Fichier",
  unitB: "o",
  unitKB: "Ko",
  unitMB: "Mo",
  unitGB: "Go",

  // Chat store toasts
  answerFailed: "Réponse impossible",
  stopFailed: "Arrêt impossible",
} satisfies Record<string, Message>;

export default chat;
