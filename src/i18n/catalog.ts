/**
 * All namespaces. French is the source of truth: each English namespace must have exactly the same keys
 * (`Translation<…>`), otherwise the build fails.
 */
import type { Message } from "./index";
import chatFr from "./fr/chat";
import commonFr from "./fr/common";
import homeFr from "./fr/home";
import memoryFr from "./fr/memory";
import projectFr from "./fr/project";
import quickFr from "./fr/quick";
import settingsFr from "./fr/settings";
import shellFr from "./fr/shell";
import chatEn from "./en/chat";
import commonEn from "./en/common";
import homeEn from "./en/home";
import memoryEn from "./en/memory";
import projectEn from "./en/project";
import quickEn from "./en/quick";
import settingsEn from "./en/settings";
import shellEn from "./en/shell";

const fr = {
  common: commonFr,
  shell: shellFr,
  home: homeFr,
  project: projectFr,
  chat: chatFr,
  quick: quickFr,
  settings: settingsFr,
  memory: memoryFr,
};

export type Catalog = typeof fr;

/** Same keys as the French namespace, each a message. */
export type Translation<T> = { [K in keyof T]: Message };

const en: { [N in keyof Catalog]: Translation<Catalog[N]> } = {
  common: commonEn,
  shell: shellEn,
  home: homeEn,
  project: projectEn,
  chat: chatEn,
  quick: quickEn,
  settings: settingsEn,
  memory: memoryEn,
};

export const catalogs = { fr, en } as const;
