import type { ThreadStatus } from "@/bindings/ThreadStatus";

export type StatusTone = "live" | "pending" | "warn" | "ok" | "danger" | "muted";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** The agent is working (animated indicator, running timer). */
  active: boolean;
}

export const STATUS: Record<ThreadStatus, StatusMeta> = {
  idle: { label: "Inactif", tone: "muted", active: false },
  starting: { label: "Démarrage", tone: "live", active: true },
  thinking: { label: "Réflexion", tone: "live", active: true },
  reading: { label: "Lecture", tone: "live", active: true },
  editing: { label: "Édition", tone: "live", active: true },
  running: { label: "Exécution", tone: "live", active: true },
  awaiting_approval: { label: "En attente d'approbation", tone: "warn", active: true },
  done: { label: "Terminé", tone: "ok", active: false },
  error: { label: "Erreur", tone: "danger", active: false },
  cancelled: { label: "Annulé", tone: "muted", active: false },
};

/** Tailwind text color per tone (static strings). */
export const TONE_TEXT: Record<StatusTone, string> = {
  live: "text-accent-2",
  pending: "text-pending",
  warn: "text-warn",
  ok: "text-ok",
  danger: "text-danger",
  muted: "text-fg-subtle",
};

export const TONE_BG: Record<StatusTone, string> = {
  live: "bg-accent-2",
  pending: "bg-pending",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
  muted: "bg-fg-subtle",
};

/** Granular, human label: "Édition de app.tsx", "Exécution : npm test", "Réflexion". */
export function describeStatus(status: ThreadStatus, detail: string | null | undefined): string {
  if (!detail) return STATUS[status].label;
  const file = detail.split(/[\\/]/).pop() ?? detail;
  switch (status) {
    case "reading":
      return `Lecture de ${file}`;
    case "editing":
      return `Édition de ${file}`;
    case "running":
      return `Exécution : ${detail}`;
    case "awaiting_approval":
      return `Approbation : ${detail}`;
    case "error":
      return `Erreur : ${detail}`;
    default:
      return `${STATUS[status].label} · ${detail}`;
  }
}
