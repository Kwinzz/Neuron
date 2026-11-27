/** Opening fence: ``` or ~~~ (3+), possibly indented, possibly followed by an info string. */
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;
/** Closing fence: same character, at least as long, nothing after it (an info string can't close a block). */
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Does `line` close the code block opened by `fence`? */
function closesFence(line: string, fence: string): boolean {
  const marker = FENCE_CLOSE.exec(line)?.[1];
  return !!marker && marker[0] === fence[0] && marker.length >= fence.length;
}

/**
 * Splits Markdown into top-level blocks that can be rendered separately while an answer streams: only the last
 * block changes, so the others are parsed once instead of at every update.
 *
 * A boundary is a blank line followed by a line that starts at column 0, outside a code fence. Indented lines
 * (list continuations, nested content) stay with their block, so lists and code keep their meaning; a loose list
 * may render as consecutive lists until the answer is complete (then it is parsed whole again).
 */
export function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let blank = false;

  for (const line of lines) {
    if (fence) {
      current.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (line.trim() === "") {
      blank = true;
      current.push(line);
      continue;
    }
    const startsBlock = blank && line === line.trimStart();
    if (startsBlock && current.some((l) => l.trim() !== "")) {
      blocks.push(current.join("\n"));
      current = [];
    }
    blank = false;
    current.push(line);
    const marker = FENCE_OPEN.exec(line)?.[1];
    if (marker) fence = marker;
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/** Is the end of `text` inside a code block that isn't closed yet? */
export function endsInsideFence(text: string): boolean {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else {
      fence = FENCE_OPEN.exec(line)?.[1] ?? null;
    }
  }
  return fence !== null;
}

/**
 * A line that only means something once the next characters arrive: a lone `-` / `=` turns the previous line
 * into a heading (setext), a bare list marker or `#` renders an empty item / heading.
 */
const UNFINISHED_LINE = /^[ \t]*(?:[-=]+|[*+]|\d{1,9}[.)]|#{1,6}|>)[ \t]*$/;
/** `[texte](C:\chemin…` whose closing parenthesis hasn't arrived: shown as its text meanwhile. */
const PARTIAL_LINK = /(!?)\[([^\]\n]*)\]\([^)\n]*$/;

/** Count of `marker` outside inline code in `line`. */
function countOutsideCode(line: string, marker: string): number {
  return line
    .split("`")
    .filter((_, i) => i % 2 === 0)
    .reduce((n, part) => n + part.split(marker).length - 1, 0);
}

/** Close (or drop, when nothing follows it yet) a marker left open at the end of `line`. */
function closeMarker(line: string, marker: string): string {
  if (countOutsideCode(line, marker) % 2 === 0) return line;
  const trimmed = line.trimEnd();
  if (trimmed.endsWith(marker)) return trimmed.slice(0, -marker.length);
  return line + marker;
}

/**
 * The end of an answer being written, as it should look meanwhile: no `**` shown raw until it closes, no
 * previous line flashing as a heading when a list starts, no half-written link. Only the last line is touched,
 * and never inside a code block. The final text is always rendered as is.
 */
export function settleStreamingTail(text: string): string {
  if (endsInsideFence(text)) return text;
  const cut = text.lastIndexOf("\n") + 1;
  const head = text.slice(0, cut);
  let line = text.slice(cut);
  if (UNFINISHED_LINE.test(line)) return head.replace(/\n$/, "");

  line = line.replace(PARTIAL_LINK, (_, bang: string, label: string) => (bang ? "" : label));
  // Inline code first (`**gras `code` → `**gras `code`**`): the innermost marker closes first.
  const ticks = line.split("`").length - 1;
  if (ticks % 2 === 1 && !/`{2,}/.test(line)) {
    line = line.trimEnd().endsWith("`") ? line.trimEnd().slice(0, -1) : `${line}\``;
  }
  line = closeMarker(line, "**");
  line = closeMarker(line, "~~");
  return head + line;
}
