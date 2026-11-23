/** Unified diff (`@@ -a,b +c,d @@` hunks, as stored with tool calls) → rows with line numbers. */

export type DiffLine =
  | { kind: "add" | "del" | "ctx"; text: string; oldNo: number | null; newNo: number | null }
  | { kind: "gap"; count: number | null };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let previousOldEnd: number | null = null;
  const lines = diff.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      // Unchanged lines skipped before this hunk (unknown after the last one).
      const skipped = previousOldEnd === null ? oldNo - 1 : oldNo - previousOldEnd;
      if (skipped > 0) rows.push({ kind: "gap", count: skipped });
      continue;
    }
    if (line.startsWith("\\")) continue; // « \ No newline at end of file »
    const mark = line[0];
    const text = line.slice(1);
    if (mark === "+") {
      rows.push({ kind: "add", text, oldNo: null, newNo: newNo++ });
    } else if (mark === "-") {
      rows.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
    } else {
      rows.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
    }
    previousOldEnd = oldNo;
  }
  return rows;
}
