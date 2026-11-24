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
    const trimmed = line.trimStart();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence) {
      current.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (line.trim() === "") {
      blank = true;
      current.push(line);
      continue;
    }
    const startsBlock = blank && line === trimmed;
    if (startsBlock && current.some((l) => l.trim() !== "")) {
      blocks.push(current.join("\n"));
      current = [];
    }
    blank = false;
    current.push(line);
    if (marker) fence = marker;
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}
