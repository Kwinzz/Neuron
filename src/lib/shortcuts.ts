import { type MessageKey, t } from "@/i18n";

/** Every global keyboard shortcut, for the help dialog and the palette hints. `mod` = Ctrl (⌘ on macOS). */
export interface Shortcut {
  id: string;
  /** useHotkey combo, e.g. "mod+k". */
  combo: string;
  /** Translated on access (getter): always in the current interface language. */
  readonly label: string;
  group: "navigation" | "chat" | "window";
}

function shortcut(id: string, combo: string, key: MessageKey, group: Shortcut["group"]): Shortcut {
  return {
    id,
    combo,
    get label() {
      return t(key);
    },
    group,
  };
}

export const SHORTCUTS: readonly Shortcut[] = [
  shortcut("palette", "mod+k", "shell.scPalette", "navigation"),
  shortcut("new-chat", "mod+n", "shell.navNewChat", "navigation"),
  shortcut("home", "mod+shift+h", "shell.navHome", "navigation"),
  shortcut("memory", "mod+shift+m", "shell.navMemory", "navigation"),
  shortcut("settings", "mod+,", "shell.navSettings", "navigation"),
  shortcut("prev-chat", "alt+arrowup", "shell.scPrevChat", "navigation"),
  shortcut("next-chat", "alt+arrowdown", "shell.scNextChat", "navigation"),
  shortcut("dock", "mod+j", "shell.scDock", "window"),
  shortcut("sidebar", "mod+b", "shell.scSidebar", "window"),
  shortcut("shortcuts", "mod+/", "shell.scHelp", "window"),
  shortcut("send", "enter", "shell.scSend", "chat"),
  shortcut("history", "arrowup", "shell.scHistory", "chat"),
  shortcut("plan-mode", "shift+tab", "shell.scPlanMode", "chat"),
  shortcut("stop", "escape", "shell.scStop", "chat"),
];

const GROUP_LABEL: Record<Shortcut["group"], MessageKey> = {
  navigation: "shell.scGroupNavigation",
  window: "shell.scGroupWindow",
  chat: "shell.scGroupChat",
};

export function shortcutGroupLabel(group: Shortcut["group"]): string {
  return t(GROUP_LABEL[group]);
}

const IS_MAC = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function keyLabel(k: string): string | undefined {
  switch (k) {
    case "mod":
      return IS_MAC ? "⌘" : "Ctrl";
    case "shift":
      return IS_MAC ? "⇧" : t("shell.keyShift");
    case "alt":
      return IS_MAC ? "⌥" : "Alt";
    case "enter":
      return t("shell.keyEnter");
    case "escape":
      return t("shell.keyEscape");
    case "tab":
      return "Tab";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    default:
      return undefined;
  }
}

/** "mod+shift+m" → ["Ctrl", "Maj", "M"] (key names in the interface language). */
export function comboKeys(combo: string): string[] {
  return combo.split("+").map((k) => keyLabel(k) ?? k.toUpperCase());
}
