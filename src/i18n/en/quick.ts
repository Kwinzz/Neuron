import type { Translation } from "../catalog";
import type fr from "../fr/quick";

/** Namespace « quick » — English (same keys as French). */
const quick: Translation<typeof fr> = {
  // QuickLauncher
  messageFor: "Message for “{title}”…",
  askInProject: "Ask something in {project}…",
  ask: "Ask something…",
  yourRequest: "Your request",
  sent: "Sent",
  destination: "Destination",
  newChat: "New chat",
  projectChats: "{project} chats",
  recentChats: "Recent chats",
  noChatsInProject: "No chats in {project} yet.",
  hintChat: "chat",
  hintAgent: "agent",
  hintModel: "model",
  hintProject: "project",
  hintSendOpen: "send + open",
  send: "Send",

  // QuickProjectPicker
  project: "Project",
  noProject: "No project",
  noProjectSearch: "no project none",
  searchProject: "Search projects…",
  noProjects: "No projects",
};

export default quick;
