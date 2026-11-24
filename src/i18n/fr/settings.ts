import type { Message } from "../index";

/** Namespace « settings » — French (source of truth). */
const settings = {
  // SettingsView
  title: "Paramètres",
  subtitle: "Préférences de Neuron, enregistrées automatiquement.",
  unavailable: "Paramètres indisponibles",

  // SettingsNav
  navLabel: "Sections des paramètres",
  navGeneral: "Général",
  navBackground: "Arrière-plan & raccourci",
  navAgents: "Agents & MCP",
  navNotifications: "Notifications",
  navContext: "Contexte injecté",
  navGeneric: "CLI génériques",
  navShortcuts: "Raccourcis",

  // SettingsSkeleton
  loadingLabel: "Chargement des paramètres",

  // useSettingsPatch
  saveFailed: "Impossible d'enregistrer les paramètres",

  // Shared by several sections
  inAppOnly: "Disponible dans l'application",
  test: "Tester",
  minUnit: "min",

  // LanguageCard
  language: "Langue",
  languageDescription: "Langue de l'interface de Neuron.",

  // GeneralSection
  idleTitle: "Arrêt des agents inactifs",
  idleDescription:
    "Les processus inactifs sont arrêtés pour libérer la mémoire ; le chat reprend automatiquement au message suivant.",
  idleGroupLabel: "Délai avant arrêt des agents inactifs",
  idleNever: "Jamais",
  idlePreset: "{n} min",
  idleCustom: "Personnalisé",
  idleNeverHint: "Les agents restent actifs tant que Neuron est ouvert.",
  idleAfterPrefix: "Arrêt après",
  idleAfterSuffix: "min d'inactivité.",

  // PricingCard
  pricingUpdated: "Tarifs à jour",
  pricingModels: "{n} modèles",
  pricingFailed: "Mise à jour impossible",
  pricingTitle: "Tarifs des modèles",
  pricingDescription:
    "Codex et Antigravity ne communiquent que des tokens : le coût de chaque requête est estimé au tarif API public du modèle. Liste LiteLLM (tarifs officiels OpenAI, Anthropic, Google), téléchargée au plus une fois par jour ; un nouveau modèle est chiffré dès qu'il y apparaît.",
  pricingModelsUpdated: "modèles · mis à jour",
  pricingBuiltin: "Table intégrée (liste en ligne pas encore téléchargée)",
  pricingLastError: "Dernier essai : {error}",
  refresh: "Actualiser",

  // BackgroundSection
  keyShift: "Maj",
  keySpace: "Espace",
  shortcutAria: "Raccourci de la demande rapide",
  shortcutRecording: "Appuie sur la combinaison…",
  bgTitle: "Arrière-plan",
  bgDescription:
    "Neuron reste dans la zone de notification (près de l'horloge) : les agents continuent, les notifications arrivent et la demande rapide reste disponible.",
  closeToTray: "Continuer en arrière-plan à la fermeture",
  closeToTrayDescription:
    "La croix cache la fenêtre au lieu de quitter. « Quitter Neuron » dans le menu de l'icône arrête tout.",
  launchWithWindows: "Lancer avec Windows",
  launchAtLogin: "Lancer à l'ouverture de session",
  launchDescriptionDev:
    "Démarre Neuron discrètement dans la zone de notification à l'ouverture de session (sans effet en mode dev : seule l'app installée s'inscrit au démarrage).",
  launchDescription: "Démarre Neuron discrètement dans la zone de notification à l'ouverture de session.",
  quickTitle: "Demande rapide",
  quickDescription:
    "Depuis n'importe quelle app (même en jeu, en plein écran fenêtré), un raccourci ouvre une petite fenêtre pour écrire ta demande et l'envoyer à un nouveau chat ou à un chat récent.",
  quickEnable: "Activer la demande rapide",
  quickShortcut: "Raccourci global",
  quickShortcutLinux:
    "Clique puis appuie sur la combinaison. Sous Wayland, les raccourcis globaux n'existent pas : lie la commande « neuron --quick » à un raccourci de ton bureau (Hyprland, KDE, GNOME…).",
  quickShortcutHint: "Clique puis appuie sur la combinaison (avec Ctrl, Alt ou Win). Échap pour annuler.",
  shortcutReset: "Raccourci par défaut",
  shortcutDefault: "Par défaut : {shortcut}",

  // NotificationsSection
  notifTitle: "Notifications",
  notifDescription: "Uniquement quand la fenêtre Neuron n'est pas au premier plan.",
  notifEnable: "Activer les notifications",
  notifEnableDescription: "Alertes système pour suivre l'activité des agents en arrière-plan",
  notifBlocked: "Notifications bloquées",
  notifBlockedWindows:
    "Windows a bloqué les notifications de Neuron. Autorise-les dans Paramètres Windows › Système › Notifications.",
  notifBlockedOther:
    "Le système a bloqué les notifications de Neuron. Autorise-les dans les réglages de notifications de ton bureau.",
  notifPermission: "Demande d'autorisation",
  notifPermissionDescription: "Un agent attend ton accord pour utiliser un outil",
  notifFinished: "Fin de réponse",
  notifFinishedDescription: "Un agent a terminé sa réponse",
  notifErrorDescription: "Un chat s'est arrêté sur une erreur",
  notifTestBody: "Les notifications fonctionnent.",
  notifSent: "Notification envoyée",

  // ContextSection
  contextTitle: "Contexte injecté",
  contextDescription: "Éléments transmis automatiquement au démarrage d'un nouveau chat.",
  ctxMemory: "Mémoire globale",
  ctxMemoryDescription: "Tes préférences et règles enregistrées dans memory.md",
  ctxGit: "Instantané git",
  ctxGitDescription: "Branche, statut et derniers commits du projet",
  ctxRecent: "Fichiers récents",
  ctxRecentDescription: "Fichiers du projet modifiés récemment",
  ctxNewChatsOnly: "S'applique aux nouveaux chats uniquement : le contexte est figé à la création du chat.",
  openMemory: "Ouvrir la mémoire",

  // ShortcutsSection
  shortcutsTitle: "Raccourcis clavier",
  shortcutsDescription: "Ctrl correspond à ⌘ sur macOS.",

  // AgentsMcpCard
  toolMemoryRead: "Lit toute la mémoire, groupée par catégorie.",
  toolMemorySearch: "Recherche plein texte dans les souvenirs.",
  toolMemorySave: "Enregistre un nouveau souvenir durable.",
  toolMemoryUpdate: "Corrige un souvenir (texte ou catégorie).",
  toolMemoryDelete: "Retire un souvenir devenu faux.",
  toolContextRead: "Lit le .neuron/context.md du projet du chat.",
  toolContextUpdate: "Met à jour le .neuron/context.md du projet.",
  copyCommandFailed: "Impossible de copier la commande",
  mcpTitle: "Agents & MCP",
  mcpDescription:
    "Les agents lisent et enrichissent la mémoire en direct via le serveur MCP de Neuron (état par agent dans « Fournisseurs IA »).",
  mcpDisabled: "Serveur MCP désactivé",
  mcpTools: "Outils exposés",
  mcpServerCommand: "Commande du serveur",
  copyCommand: "Copier la commande",

  // AgyMemoryLine
  agyConnected: "Antigravity connecté à la mémoire",
  agyDisconnected: "Antigravity déconnecté de la mémoire",
  agyConnectFailed: "Impossible de connecter Antigravity",
  agyDisconnectFailed: "Impossible de déconnecter Antigravity",
  memoryLinked: "Mémoire Neuron branchée",
  unplug: "Débrancher",
  memoryOutdated: "Mémoire à rebrancher (chemin de Neuron changé)",
  agyMcpHint:
    "Antigravity n'accepte pas de serveur MCP par session : Neuron l'inscrit une fois dans sa configuration (agy mcp add neuron).",
  memoryNotLinked: "Mémoire Neuron non branchée",
  replug: "Rebrancher",
  plugMemory: "Brancher la mémoire",

  // ProvidersCard
  providersTitle: "Fournisseurs IA",
  providersDescription:
    "Les CLI que Neuron pilote. L'installation et la connexion s'ouvrent dans un terminal ; Neuron détecte la fin tout seul.",
  recheck: "Vérifier à nouveau",
  unknownState: "État inconnu",
  ready: "Prêt",
  memoryEverySession: "Mémoire Neuron branchée à chaque session",
  officialCommand: "Commande officielle : ",
  commandLabel: "Commande : ",
  notInstalled: "Non installé",
  installedNotSignedIn: "Installé · non connecté",
  installedUnverifiable: "Installé · connexion non vérifiable",
  signedIn: "Connecté",
  signedInAs: "Connecté · {account}",

  // GenericClisSection
  cliDeleted: "CLI supprimé",
  cliDeleteFailed: "Impossible de supprimer le CLI",
  genericTitle: "CLI génériques",
  genericDescription:
    "Un processus par message, sans mémoire entre les messages ni demande d'autorisation. Utilisable comme modèle dans « Nouveau chat ».",
  addCli: "Ajouter un CLI",
  genericEmpty: "Aucun CLI générique. Ajoute Ollama, Aider, Gemini CLI… pour les utiliser comme modèle.",

  // GenericCliEditor
  cliSaved: "CLI enregistré",
  cliSaveFailed: "Impossible d'enregistrer le CLI",
  editCli: "Modifier « {name} »",
  newCli: "Nouveau CLI",
  presets: "Préréglages",
  cliName: "Nom",
  cliCommand: "Commande",
  cliArgs: "Arguments",
  cliArgsHint: "(un par ligne)",
  promptReplaced: "sera remplacé par ton message ; sans",
  promptStdin: ", le message est envoyé sur l'entrée standard.",
  pty: "Pseudo-terminal",
  ptyDescription: "Pour les outils qui exigent un vrai terminal ; les codes couleur sont retirés.",
  preview: "Aperçu",

  // GenericCliCommandPreview
  commandPlaceholder: "commande…",
  stdinHint: "← message sur stdin",

  // GenericCliDeleteDialog
  deleteCliTitle: "Supprimer ce CLI ?",
  deleteCliDescription: "Les chats existants qui l'utilisent ne pourront plus envoyer de message.",

  // GenericCliTestResult
  testReceivedIn: "Réponse reçue en",
  testFailed: "Échec du test",
  closeTestResult: "Fermer le résultat du test",
  noOutput: "(aucune sortie)",

  // AgentAccessButton
  installing: "Installation en cours…",
  signingIn: "Connexion en cours…",
  stopWaiting: "Arrêter d'attendre",
  installAgent: "Installer {agent}",
  signInAgent: "Se connecter à {agent}",
  install: "Installer",
  signIn: "Se connecter",

  // stores/access
  installFailed: "Installation impossible",
  signInFailed: "Connexion impossible",
  agentInstalled: "{agent} est installé",
  signInRemaining: "Il reste à te connecter à ton compte.",
  agentSignedIn: "{agent} est connecté",
} satisfies Record<string, Message>;

export default settings;
