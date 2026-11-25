import type { Message } from "../index";

/** Namespace « quick » — French (source of truth). */
const quick = {
  // QuickLauncher
  messageFor: "Message pour « {title} »…",
  askInProject: "Demande quelque chose dans {project}…",
  ask: "Demande quelque chose…",
  yourRequest: "Ta demande",
  sent: "Envoyé",
  destination: "Destination",
  newChat: "Nouveau chat",
  projectChats: "Chats de {project}",
  recentChats: "Chats récents",
  noChatsInProject: "Aucun chat dans {project} pour l'instant.",
  hintChat: "chat",
  hintAgent: "agent",
  hintModel: "modèle",
  hintEffort: "raisonnement",
  hintProject: "projet",
  hintSendOpen: "envoyer + ouvrir",
  send: "Envoyer",

  // QuickProjectPicker
  project: "Projet",
  noProject: "Sans projet",
  /** Search keywords of the « no project » entry. */
  noProjectSearch: "sans projet aucun",
  searchProject: "Rechercher un projet…",
  noProjects: "Aucun projet",
} satisfies Record<string, Message>;

export default quick;
