/**
 * Interface language (fr / en). Usage, anywhere (render, stores, toasts):
 *
 *   import { t } from "@/i18n";
 *   t("chat.send")                      // plain message
 *   t("home.providersCount", { n: 3 })  // `{n}` placeholders, or a function message for plurals
 *
 * Messages live per namespace in `src/i18n/fr/<ns>.ts` (source of truth) and `src/i18n/en/<ns>.ts` (same keys,
 * enforced by the compiler through `catalog.ts`). Changing the language remounts the app (`App` keyed by the
 * language), so plain `t()` calls in render are always up to date.
 */
import { create } from "zustand";
import { catalogs, type Catalog } from "./catalog";

export type Lang = "fr" | "en";
export type Vars = Record<string, string | number>;
/** A message: text with `{name}` placeholders, or a function (plurals, small logic). */
export type Message = string | ((vars: Vars) => string);

/** "chat.send", "settings.language"… — every key of the French catalog. */
export type MessageKey = {
  [N in keyof Catalog]: `${N & string}.${keyof Catalog[N] & string}`;
}[keyof Catalog];

const STORAGE_KEY = "neuron.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // storage unavailable: fall through
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Lang = initialLang();

interface LocaleState {
  lang: Lang;
}

/** Subscribe to the language (the app root is keyed by it). */
export const useLocale = create<LocaleState>(() => ({ lang: current }));

export function getLang(): Lang {
  return current;
}

/** Switch the interface language (remembered for the next start before the settings are read). */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not persisted: the backend setting still applies at the next start
  }
  document.documentElement.lang = lang;
  useLocale.setState({ lang });
}

/** BCP 47 locale for `Intl` formatters. */
export function locale(): string {
  return current === "fr" ? "fr-FR" : "en-US";
}

export function t(key: MessageKey, vars?: Vars): string {
  const dot = key.indexOf(".");
  const ns = key.slice(0, dot) as keyof Catalog;
  const name = key.slice(dot + 1);
  const table = catalogs[current][ns] as Record<string, Message | undefined>;
  const message = table[name] ?? (catalogs.fr[ns] as Record<string, Message | undefined>)[name] ?? key;
  if (typeof message === "function") return message(vars ?? {});
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (all, v: string) => (v in vars ? String(vars[v]) : all));
}

/** `t` for components that want to re-render on a language change without the root remount. */
export function useT(): typeof t {
  useLocale((s) => s.lang);
  return t;
}
