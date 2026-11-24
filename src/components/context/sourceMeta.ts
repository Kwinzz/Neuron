import { Brain, FileText, GitBranch, History, type LucideIcon } from "lucide-react";
import type { ContextSourceKind } from "@/bindings/ContextSourceKind";
import { type MessageKey, t } from "@/i18n";

export const SOURCE_ICON: Record<ContextSourceKind, LucideIcon> = {
  file: FileText,
  git: GitBranch,
  recent: History,
  memory: Brain,
};

const SOURCE_LABEL: Record<ContextSourceKind, MessageKey> = {
  file: "project.ctxSourceFile",
  git: "project.ctxSourceGit",
  recent: "project.ctxSourceRecent",
  memory: "project.ctxSourceMemory",
};

export function sourceLabel(kind: ContextSourceKind): string {
  return t(SOURCE_LABEL[kind]);
}
