import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import type { ImportedMemory } from "@/bindings/ImportedMemory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import type { Vendor } from "@/components/ui/AgentLogo";

export interface ImportOriginMeta {
  /** Picker label. */
  label: string;
  /** Used in « Importé de <source> ». */
  source: string;
  vendor: Vendor;
  /** Web assistant with no export file: the user pastes the assistant's answer. */
  web: boolean;
}

export const IMPORT_ORIGINS: Record<MemoryImportOrigin, ImportOriginMeta> = {
  claude_ai: { label: "claude.ai", source: "claude.ai", vendor: "anthropic", web: true },
  chatgpt: { label: "ChatGPT", source: "ChatGPT", vendor: "openai", web: true },
  gemini: { label: "Gemini", source: "Gemini", vendor: "google", web: true },
  claude_code: { label: "Claude Code", source: "Claude Code", vendor: "anthropic", web: false },
  codex: { label: "Codex", source: "Codex", vendor: "openai", web: false },
  gemini_cli: { label: "Gemini CLI", source: "Gemini CLI", vendor: "google", web: false },
  other: { label: "Autre", source: "un import", vendor: "other", web: false },
};

export const WEB_ORIGINS: readonly MemoryImportOrigin[] = ["claude_ai", "chatgpt", "gemini"];
export const CLI_ORIGINS: readonly MemoryImportOrigin[] = ["claude_code", "codex", "gemini_cli"];

export function isMemoryImportOrigin(value: string): value is MemoryImportOrigin {
  return Object.prototype.hasOwnProperty.call(IMPORT_ORIGINS, value);
}

/** The prompt to give a web assistant so it lists what it knows. */
export const WEB_EXPORT_PROMPT = "Liste tous les souvenirs que tu as sur moi, un par ligne, sans commentaire.";

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
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} Ko`;
  return `${(kb / 1024).toFixed(1)} Mo`;
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
