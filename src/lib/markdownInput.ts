/**
 * Markdown helpers for the message input (pure: text + selection in, replacement out).
 * The composer applies an `Edit` with `insertText`, so Ctrl+Z undoes it.
 */
import { endsInsideFence } from "@/components/markdown/splitBlocks";

/** Replace `[start, end)` with `text`, then select `[selStart, selEnd)`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selStart: number;
  selEnd: number;
}

/** Number of `ch` characters `s` ends with. */
function trailing(s: string, ch: string): number {
  let n = 0;
  while (n < s.length && s[s.length - 1 - n] === ch) n++;
  return n;
}

/** Number of `ch` characters `s` starts with. */
function leading(s: string, ch: string): number {
  let n = 0;
  while (n < s.length && s[n] === ch) n++;
  return n;
}

/**
 * With `left` / `right` copies of the marker character on each side, is the text wrapped by `marker`?
 * `*` inside `**…**` is not italic; inside `***…***` it is (bold + italic).
 */
function wraps(left: number, right: number, marker: string): boolean {
  if (left < marker.length || right < marker.length) return false;
  return marker.length !== 1 || (left !== 2 && right !== 2);
}

/** Is the selection surrounded by `marker` (just outside it)? */
function wrappedBy(before: string, after: string, marker: string): boolean {
  const ch = marker[0] ?? "";
  return wraps(trailing(before, ch), leading(after, ch), marker);
}

/** Does the selection itself start and end with `marker`? */
function selectionWrapped(selected: string, marker: string): boolean {
  const ch = marker[0] ?? "";
  return selected.length >= 2 * marker.length && wraps(leading(selected, ch), trailing(selected, ch), marker);
}

/**
 * Bold (`**`), italic (`*`), strikethrough (`~~`), inline code (`` ` ``): wraps the selection, or unwraps it when it
 * is already wrapped. Without selection, inserts the pair and puts the caret between. Code over several lines
 * becomes a code block.
 */
export function toggleWrap(value: string, start: number, end: number, marker: string): TextEdit {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const m = marker.length;

  // Markers inside the selection: `**gras**` selected whole.
  if (selectionWrapped(selected, marker)) {
    const inner = selected.slice(m, -m);
    return { start, end, text: inner, selStart: start, selEnd: start + inner.length };
  }
  // Markers around the selection: `**[gras]**`.
  if (wrappedBy(before, after, marker)) {
    return { start: start - m, end: end + m, text: selected, selStart: start - m, selEnd: end - m };
  }
  if (marker === "`" && selected.includes("\n")) {
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    const text = `${lead}\`\`\`\n${selected}\n\`\`\``;
    const inner = start + lead.length + 4;
    return { start, end, text, selStart: inner, selEnd: inner + selected.length };
  }
  return { start, end, text: marker + selected + marker, selStart: start + m, selEnd: end + m };
}

/** `- `, `* `, `+ `, `1. `, `1) `, task `- [ ] `, quote `> ` at the start of a line. */
const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
const QUOTE = /^([ \t]*(?:>[ \t]?)+)/;

/**
 * New line in a list or a quote (Maj+Entrée): the next line starts with the next marker (`- `, `3. `, `- [ ] `,
 * `> `). On an empty item, the marker is removed instead (end of the list). Null = ordinary new line.
 */
export function continueBlock(value: string, start: number, end: number): TextEdit | null {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const line = value.slice(lineStart, start);
  if (endsInsideFence(value.slice(0, lineStart))) return null;

  const item = LIST_ITEM.exec(line);
  if (item) {
    const [all, indent = "", bullet, num, delim, space = " ", task] = item;
    if (line.trim() === all.trim() && value.slice(end).split("\n")[0]?.trim() === "") {
      // Empty item: leave the list.
      return { start: lineStart, end, text: "", selStart: lineStart, selEnd: lineStart };
    }
    const marker = bullet ?? `${Number(num) + 1}${delim ?? "."}`;
    const text = `\n${indent}${marker}${space}${task ? "[ ] " : ""}`;
    return { start, end, text, selStart: start + text.length, selEnd: start + text.length };
  }

  const quote = QUOTE.exec(line);
  if (quote) {
    const prefix = quote[1] ?? "> ";
    if (line.trim() === prefix.trim()) {
      return { start: lineStart, end, text: "", selStart: lineStart, selEnd: lineStart };
    }
    const text = `\n${prefix}`;
    return { start, end, text, selStart: start + text.length, selEnd: start + text.length };
  }
  return null;
}

/** Is the caret inside a code block that isn't closed yet (Entrée then adds a line instead of sending)? */
export function caretInOpenFence(value: string, caret: number): boolean {
  return endsInsideFence(value.slice(0, caret));
}
