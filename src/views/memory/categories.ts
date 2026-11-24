import { Code2, Cpu, ShieldAlert, StickyNote, User, type LucideIcon } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { AGENTS } from "@/lib/agents";
import { IMPORT_ORIGINS, isMemoryImportOrigin } from "./importOrigins";

export const CATEGORY_ORDER: readonly MemoryCategory[] = [
  "profile",
  "tech_preferences",
  "code_style",
  "strict_rules",
  "other",
];

export interface CategoryMeta {
  label: string;
  short: string;
  description: string;
  example: string;
  icon: LucideIcon;
  iconClass: string;
}

export const CATEGORIES: Record<MemoryCategory, CategoryMeta> = {
  profile: {
    label: "Profil",
    short: "Profil",
    description: "Qui tu es, ton contexte, ta façon de travailler.",
    example: "Développeur full-stack, je parle français, réponses concises.",
    icon: User,
    iconClass: "text-muted-foreground",
  },
  tech_preferences: {
    label: "Préférences techniques",
    short: "Préf. techniques",
    description: "Langages, outils et bibliothèques que tu privilégies.",
    example: "Préférer pnpm à npm ; TypeScript strict partout.",
    icon: Cpu,
    iconClass: "text-muted-foreground",
  },
  code_style: {
    label: "Style de code",
    short: "Style de code",
    description: "Conventions de nommage, formatage, structure.",
    example: "Composants fonctionnels, un composant par fichier.",
    icon: Code2,
    iconClass: "text-muted-foreground",
  },
  strict_rules: {
    label: "Règles strictes",
    short: "Règles strictes",
    description: "Interdits et obligations que les agents doivent toujours respecter.",
    example: "Ne jamais pousser sur main sans demande.",
    icon: ShieldAlert,
    iconClass: "text-warn",
  },
  other: {
    label: "Autres",
    short: "Autres",
    description: "Tout le reste.",
    example: "Mon éditeur est VS Code.",
    icon: StickyNote,
    iconClass: "text-muted-foreground",
  },
};

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (
    value === "profile" ||
    value === "tech_preferences" ||
    value === "code_style" ||
    value === "strict_rules" ||
    value === "other"
  );
}

function isNamedAgentKind(value: string): value is Exclude<AgentKind, "generic"> {
  return value === "claude_code" || value === "codex" || value === "antigravity";
}

export type SourceDescription =
  | { kind: "user" }
  | { kind: "file" }
  | { kind: "import"; origin: string; label: string }
  | { kind: "agent"; agent: AgentKind | null; label: string };

export function describeSource(source: string): SourceDescription {
  if (source === "user") return { kind: "user" };
  if (source === "file") return { kind: "file" };
  if (source.startsWith("import:")) {
    const origin = source.slice("import:".length);
    const label = isMemoryImportOrigin(origin) ? IMPORT_ORIGINS[origin].source : IMPORT_ORIGINS.other.source;
    return { kind: "import", origin, label };
  }
  if (source.startsWith("agent:")) {
    const suffix = source.slice("agent:".length);
    if (isNamedAgentKind(suffix)) {
      return { kind: "agent", agent: suffix, label: AGENTS[suffix].label };
    }
    return { kind: "agent", agent: null, label: suffix || "agent" };
  }
  return { kind: "agent", agent: null, label: source };
}
