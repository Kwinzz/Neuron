import {
  Bot,
  FilePen,
  FileSearch,
  Globe,
  type LucideIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ToolStatus } from "@/bindings/ToolStatus";

/** Extract the base tool name (handles MCP-prefixed names like `mcp__server__Tool`). */
export function baseToolName(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

export function toolIcon(name: string): LucideIcon {
  const base = baseToolName(name);
  switch (base) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return FilePen;
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
      return FileSearch;
    case "Bash":
    case "PowerShell":
    case "BashOutput":
      return SquareTerminal;
    case "Task":
    case "Agent":
      return Bot;
    default:
      return base.startsWith("Web") ? Globe : Wrench;
  }
}

export const TOOL_STATUS: Record<
  ToolStatus,
  { tone: "cyan" | "muted" | "danger" | "warn"; label: string; text: string }
> = {
  running: { tone: "cyan", label: "En cours", text: "text-hl-2" },
  ok: { tone: "muted", label: "Terminé", text: "text-fg-subtle" },
  error: { tone: "danger", label: "Échec", text: "text-danger" },
  denied: { tone: "warn", label: "Refusé", text: "text-warn" },
};
