import type { ThreadStatus } from "@/bindings/ThreadStatus";
import { type MessageKey, t } from "@/i18n";

export type StatusTone = "live" | "pending" | "warn" | "ok" | "danger" | "muted";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** The agent is working (animated indicator, running timer). */
  active: boolean;
}

/** `label` is a getter so it always follows the interface language. */
function meta(key: MessageKey, tone: StatusTone, active: boolean): StatusMeta {
  return {
    get label() {
      return t(key);
    },
    tone,
    active,
  };
}

export const STATUS: Record<ThreadStatus, StatusMeta> = {
  idle: meta("shell.statusIdle", "muted", false),
  starting: meta("shell.statusStarting", "live", true),
  thinking: meta("shell.statusThinking", "live", true),
  reading: meta("shell.statusReading", "live", true),
  editing: meta("shell.statusEditing", "live", true),
  running: meta("shell.statusRunning", "live", true),
  awaiting_approval: meta("shell.statusAwaitingApproval", "warn", true),
  done: meta("shell.statusDone", "ok", false),
  error: meta("common.error", "danger", false),
  cancelled: meta("shell.statusCancelled", "muted", false),
};

/** Tailwind text color per tone (static strings). */
export const TONE_TEXT: Record<StatusTone, string> = {
  live: "text-hl-2",
  pending: "text-pending",
  warn: "text-warn",
  ok: "text-ok",
  danger: "text-danger",
  muted: "text-fg-subtle",
};

export const TONE_BG: Record<StatusTone, string> = {
  live: "bg-hl-2",
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
      return t("shell.statusReadingFile", { file });
    case "editing":
      return t("shell.statusEditingFile", { file });
    case "running":
      return t("shell.statusRunningDetail", { detail });
    case "awaiting_approval":
      return t("shell.statusApprovalDetail", { detail });
    case "error":
      return t("shell.statusErrorDetail", { detail });
    default:
      return `${STATUS[status].label} · ${detail}`;
  }
}
