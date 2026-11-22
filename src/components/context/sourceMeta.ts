import { Brain, FileText, GitBranch, History, type LucideIcon } from "lucide-react";
import type { ContextSourceKind } from "@/bindings/ContextSourceKind";

export const SOURCE_ICON: Record<ContextSourceKind, LucideIcon> = {
  file: FileText,
  git: GitBranch,
  recent: History,
  memory: Brain,
};

export const SOURCE_LABEL: Record<ContextSourceKind, string> = {
  file: "Fichier",
  git: "Git",
  recent: "Récents",
  memory: "Mémoire",
};
