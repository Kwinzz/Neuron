/** Chat settings shared by the composer pickers (model, reasoning effort, permissions). */
import type { AgentKind } from "@/bindings/AgentKind";
import { t } from "@/i18n";

/** Labels for every reasoning level any provider may expose (getters: they follow the interface language). */
export const EFFORT_LABEL: Record<string, string> = {
  get minimal() {
    return t("shell.effortMinimal");
  },
  get low() {
    return t("shell.effortLow");
  },
  get medium() {
    return t("shell.effortMedium");
  },
  get high() {
    return t("shell.effortHigh");
  },
  get xhigh() {
    return t("shell.effortXhigh");
  },
  get max() {
    return t("shell.effortMax");
  },
  get ultra() {
    return t("shell.effortUltra");
  },
};

/** Default levels when a model doesn't list its own. */
export const DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** `label` / `hint` are getters: they follow the interface language. */
export const PERMISSION_MODES = [
  {
    id: "manual",
    get label() {
      return t("shell.permManual");
    },
    get hint() {
      return t("shell.permManualHint");
    },
  },
  {
    id: "acceptEdits",
    get label() {
      return t("shell.permAcceptEdits");
    },
    get hint() {
      return t("shell.permAcceptEditsHint");
    },
  },
  {
    id: "auto",
    get label() {
      return t("shell.permAuto");
    },
    get hint() {
      return t("shell.permAutoHint");
    },
  },
  {
    id: "plan",
    get label() {
      return t("shell.permPlan");
    },
    get hint() {
      return t("shell.permPlanHint");
    },
  },
  {
    id: "bypassPermissions",
    get label() {
      return t("shell.permBypass");
    },
    get hint() {
      return t("shell.permBypassHint");
    },
  },
] as const;

export function effortLabel(id: string | null | undefined): string {
  if (!id) return t("shell.effortDefault");
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
