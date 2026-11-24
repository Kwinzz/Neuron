import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import type { ImportedMemory } from "@/bindings/ImportedMemory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import type { Vendor } from "@/components/ui/AgentLogo";
import { t } from "@/i18n";

export interface ImportOriginMeta {
  /** Assistant / CLI name (picker label, « Importé de <name> »); null for « Autre » (see `originLabel`). */
  name: string | null;
  vendor: Vendor;
  /** Web assistant with no export file: the user pastes the assistant's answer. */
  web: boolean;
}

export const IMPORT_ORIGINS: Record<MemoryImportOrigin, ImportOriginMeta> = {
  claude_ai: { name: "claude.ai", vendor: "anthropic", web: true },
  chatgpt: { name: "ChatGPT", vendor: "openai", web: true },
  gemini: { name: "Gemini", vendor: "google", web: true },
  claude_code: { name: "Claude Code", vendor: "anthropic", web: false },
  codex: { name: "Codex", vendor: "openai", web: false },
  gemini_cli: { name: "Gemini CLI", vendor: "google", web: false },
  other: { name: null, vendor: "other", web: false },
};

export const WEB_ORIGINS: readonly MemoryImportOrigin[] = ["claude_ai", "chatgpt", "gemini"];
export const CLI_ORIGINS: readonly MemoryImportOrigin[] = ["claude_code", "codex", "gemini_cli"];

export function isMemoryImportOrigin(value: string): value is MemoryImportOrigin {
  return Object.prototype.hasOwnProperty.call(IMPORT_ORIGINS, value);
}

/** Picker label of an origin (« Autre » translated). */
export function originLabel(origin: MemoryImportOrigin): string {
  return IMPORT_ORIGINS[origin].name ?? t("memory.originOther");
}

/** The prompt to give a web assistant so it lists what it knows. */
export function webExportPrompt(): string {
  return t("memory.webExportPrompt");
}

/**
 * Same normalisation as the backend duplicate check (`memory::import::normalize`): lowercase, accents and
 * typographic apostrophe folded, whitespace collapsed.
 */
export function normalizeMemory(content: string): string {
  return content
    .toLowerCase()
    .replace(/[àâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ùûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/’/g, "'")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return t("memory.sizeBytes", { n: bytes });
  const kb = bytes / 1024;
  if (kb < 1024) return t("memory.sizeKb", { n: kb < 10 ? kb.toFixed(1) : Math.round(kb) });
  return t("memory.sizeMb", { n: (kb / 1024).toFixed(1) });
}

/** One editable row of the import preview. */
export interface ImportRow {
  id: number;
  category: MemoryCategory;
  content: string;
  checked: boolean;
}

let nextRowId = 1;

/** Preview rows from the backend split / reformulation: memories already known start unchecked. */
export function toImportRows(items: readonly ImportedMemory[], existing: ReadonlySet<string>): ImportRow[] {
  return items.map((item) => ({
    id: nextRowId++,
    category: item.category,
    content: item.content,
    checked: !existing.has(normalizeMemory(item.content)),
  }));
}

/** Longest text the backend accepts for the AI reformulation. */
export const REFORMULATE_MAX_CHARS = 20_000;
