/** Every global keyboard shortcut, for the help dialog and the palette hints. `mod` = Ctrl (⌘ on macOS). */
export interface Shortcut {
  id: string;
  /** useHotkey combo, e.g. "mod+k". */
  combo: string;
  label: string;
  group: "Navigation" | "Chat" | "Fenêtre";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", combo: "mod+k", label: "Palette de commandes / rechercher", group: "Navigation" },
  { id: "new-chat", combo: "mod+n", label: "Nouveau chat", group: "Navigation" },
  { id: "home", combo: "mod+shift+h", label: "Accueil", group: "Navigation" },
  { id: "memory", combo: "mod+shift+m", label: "Mémoire", group: "Navigation" },
  { id: "settings", combo: "mod+,", label: "Paramètres", group: "Navigation" },
  { id: "prev-chat", combo: "alt+arrowup", label: "Chat précédent (récents)", group: "Navigation" },
  { id: "next-chat", combo: "alt+arrowdown", label: "Chat suivant (récents)", group: "Navigation" },
  { id: "dock", combo: "mod+j", label: "Afficher / masquer les threads live", group: "Fenêtre" },
  { id: "sidebar", combo: "mod+b", label: "Afficher / masquer la barre latérale", group: "Fenêtre" },
  { id: "shortcuts", combo: "mod+/", label: "Aide des raccourcis", group: "Fenêtre" },
  { id: "send", combo: "enter", label: "Envoyer le message (Maj+Entrée : nouvelle ligne)", group: "Chat" },
  { id: "history", combo: "arrowup", label: "Message précédent (zone de saisie vide)", group: "Chat" },
  { id: "plan-mode", combo: "shift+tab", label: "Basculer Exécuter / Planifier (zone de saisie)", group: "Chat" },
  { id: "stop", combo: "escape", label: "Arrêter l'agent en cours (dans un chat)", group: "Chat" },
];

const IS_MAC = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

const KEY_LABEL: Record<string, string> = {
  mod: IS_MAC ? "⌘" : "Ctrl",
  shift: IS_MAC ? "⇧" : "Maj",
  alt: IS_MAC ? "⌥" : "Alt",
  enter: "Entrée",
  escape: "Échap",
  tab: "Tab",
  arrowup: "↑",
  arrowdown: "↓",
};

/** "mod+shift+m" → ["Ctrl", "Maj", "M"]. */
export function comboKeys(combo: string): string[] {
  return combo.split("+").map((k) => KEY_LABEL[k] ?? k.toUpperCase());
}
