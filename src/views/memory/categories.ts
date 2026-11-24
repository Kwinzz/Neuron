import { Code2, Cpu, ShieldAlert, StickyNote, User, type LucideIcon } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { AGENTS } from "@/lib/agents";
import { t, type MessageKey } from "@/i18n";
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

/** Static part of each category; the texts are message keys, translated when read (`categoryMeta`). */
const CATEGORY_DEFS: Record<
  MemoryCategory,
  { label: MessageKey; short: MessageKey; description: MessageKey; example: MessageKey; icon: LucideIcon; iconClass: string }
> = {
  profile: {
    label: "memory.catProfile",
    short: "memory.catProfileShort",
    description: "memory.catProfileDescription",
    example: "memory.catProfileExample",
    icon: User,
    iconClass: "text-muted-foreground",
  },
  tech_preferences: {
    label: "memory.catTech",
    short: "memory.catTechShort",
    description: "memory.catTechDescription",
    example: "memory.catTechExample",
    icon: Cpu,
    iconClass: "text-muted-foreground",
  },
  code_style: {
    label: "memory.catCodeStyle",
    short: "memory.catCodeStyleShort",
    description: "memory.catCodeStyleDescription",
    example: "memory.catCodeStyleExample",
    icon: Code2,
    iconClass: "text-muted-foreground",
  },
  strict_rules: {
    label: "memory.catStrict",
    short: "memory.catStrictShort",
    description: "memory.catStrictDescription",
    example: "memory.catStrictExample",
    icon: ShieldAlert,
    iconClass: "text-warn",
  },
  other: {
    label: "memory.catOther",
    short: "memory.catOtherShort",
    description: "memory.catOtherDescription",
    example: "memory.catOtherExample",
    icon: StickyNote,
    iconClass: "text-muted-foreground",
  },
};

/** Label, description, example and icon of a category, in the current language. */
export function categoryMeta(category: MemoryCategory): CategoryMeta {
  const def = CATEGORY_DEFS[category];
  return {
    label: t(def.label),
    short: t(def.short),
    description: t(def.description),
    example: t(def.example),
    icon: def.icon,
    iconClass: def.iconClass,
  };
}

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
  /** `label`: the assistant / CLI name, null for « Autre » or an unknown origin. */
  | { kind: "import"; origin: string; label: string | null }
  | { kind: "agent"; agent: AgentKind | null; label: string };

export function describeSource(source: string): SourceDescription {
  if (source === "user") return { kind: "user" };
  if (source === "file") return { kind: "file" };
  if (source.startsWith("import:")) {
    const origin = source.slice("import:".length);
    const label = isMemoryImportOrigin(origin) ? IMPORT_ORIGINS[origin].name : null;
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
