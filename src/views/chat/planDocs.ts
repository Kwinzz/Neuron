import type { FileChange } from "@/bindings/FileChange";
import { parseUnifiedDiff } from "./diffRows";

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/** A plan written by the agent (agy `brain/<conv>/plan.md`, any `*plan*.md`). */
export function isPlanName(path: string): boolean {
  return MARKDOWN.test(path) && /plan/i.test(baseName(path));
}

/**
 * Markdown documents shown as files rather than diffs: plans, and Antigravity's artifacts (its `brain` folder:
 * plan.md, task.md, walkthrough.md…). Claude's `~/.claude/plans/` file is excluded: the ExitPlanMode block shows it.
 */
export function isDocument(change: FileChange): boolean {
  const path = change.path.replace(/\\/g, "/");
  if (change.kind === "delete" || !MARKDOWN.test(path) || path.includes("/.claude/plans/")) return false;
  return isPlanName(path) || /\/antigravity[^/]*\/brain\//.test(path);
}

/** Full text of the document (new file: its added lines when the content was not stored). */
export function documentText(change: FileChange): string | null {
  if (change.content != null) return change.content;
  if (change.kind !== "add") return null;
  return parseUnifiedDiff(change.diff)
    .filter((r) => r.kind === "add")
    .map((r) => (r.kind === "add" ? r.text : ""))
    .join("\n");
}
