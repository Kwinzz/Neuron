/** Chat settings shared by the composer pickers (model, reasoning effort, permissions). */
import type { AgentKind } from "@/bindings/AgentKind";

/** Labels for every reasoning level any provider may expose. */
export const EFFORT_LABEL: Record<string, string> = {
  minimal: "Minimal",
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Max",
  ultra: "Ultra",
};

/** Default levels when a model doesn't list its own. */
export const DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const PERMISSION_MODES = [
  { id: "manual", label: "Demander", hint: "Chaque action sensible attend ton approbation." },
  { id: "acceptEdits", label: "Éditions auto", hint: "Modifs de fichiers acceptées, commandes à approuver." },
  { id: "plan", label: "Plan", hint: "Lecture seule : l'agent propose un plan." },
  { id: "bypassPermissions", label: "Tout autoriser", hint: "Aucune confirmation — dossiers jetables uniquement." },
] as const;

export function effortLabel(id: string | null | undefined): string {
  if (!id) return "Par défaut";
  return EFFORT_LABEL[id] ?? id;
}

export function permissionLabel(id: string): string {
  return PERMISSION_MODES.find((p) => p.id === id)?.label ?? id;
}

/** Chat settings edited in the composer bar. `null` = CLI default. */
export interface ChatSettings {
  agent: AgentKind;
  model: string | null;
  effort: string | null;
  permissionMode: string;
}
