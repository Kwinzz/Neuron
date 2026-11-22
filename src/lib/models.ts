/** Model / reasoning / permission options for Claude Code chats. */

/** Sentinel for "use the CLI default" (Radix Select items cannot have an empty value). */
export const DEFAULT = "default";

export interface ModelOption {
  /** Exact model id passed to `claude --model`. */
  id: string;
  label: string;
  hint: string;
}

export const CLAUDE_MODELS: readonly ModelOption[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Le plus capable" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Équilibré" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Rapide et économique" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", hint: "Génération précédente" },
];

/** Levels accepted by `claude --effort` (must match EFFORT_LEVELS in Rust). */
export const EFFORT_LEVELS = [
  { id: "low", label: "Faible" },
  { id: "medium", label: "Moyen" },
  { id: "high", label: "Élevé" },
  { id: "xhigh", label: "Très élevé" },
  { id: "max", label: "Maximum" },
] as const;

export const PERMISSION_MODES = [
  { id: "manual", label: "Demander", hint: "Chaque action sensible attend ton approbation." },
  { id: "acceptEdits", label: "Éditions auto", hint: "Modifs de fichiers acceptées, commandes à approuver." },
  { id: "plan", label: "Plan", hint: "Lecture seule : l'agent propose un plan." },
  { id: "bypassPermissions", label: "Tout autoriser", hint: "Aucune confirmation — dossiers jetables uniquement." },
] as const;

export function modelLabel(id: string | null | undefined): string {
  if (!id) return "Modèle par défaut";
  return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function effortLabel(id: string | null | undefined): string {
  if (!id) return "Raisonnement par défaut";
  return EFFORT_LEVELS.find((e) => e.id === id)?.label ?? id;
}

/** Chat settings edited in the composer bar. `null` = CLI default. */
export interface ChatSettings {
  model: string | null;
  effort: string | null;
  permissionMode: string;
}
