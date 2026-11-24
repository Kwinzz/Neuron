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
import type { MessageKey } from "@/i18n";

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
  { label: MessageKey; text: string; border: string }
> = {
  running: { label: "chat.toolRunning", text: "text-live", border: "border-live/30" },
  ok: { label: "chat.toolDone", text: "text-muted-foreground", border: "border-border" },
  error: { label: "common.error", text: "text-destructive", border: "border-destructive/40" },
  denied: { label: "chat.denied", text: "text-warn", border: "border-warn/40" },
};
