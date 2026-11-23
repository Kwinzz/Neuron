/** Slash-command helpers for the chat timeline. */

export interface SlashMessage {
  /** Without the leading slash. */
  name: string;
  args: string;
}

/** « /name args » (name without « / », so paths like « /etc/hosts » stay plain messages). */
const SLASH = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/;

export function parseSlash(text: string): SlashMessage | null {
  const m = SLASH.exec(text.trim());
  if (!m?.[1]) return null;
  return { name: m[1], args: (m[2] ?? "").trim() };
}

export type OutputBlock =
  | { kind: "meter"; label: string; percent: number; note: string | null }
  | { kind: "text"; text: string };

/** « Current session: 2% used · resets Nov 23, 10pm » */
const METER = /^\s*([^:]{1,80}):\s*(\d+(?:[.,]\d+)?)\s*%\s*(?:used|utilisée?s?)(?![\p{L}\w])(?:\s*[·•\-]\s*(.+?))?\s*$/iu;

/** Markdown output (/context): headings, tables or bold. */
export function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s|^\s*\|.*\|\s*$|\*\*[^*\n]+\*\*/m.test(text);
}

/** Plain command output split into text blocks and « N% used » meters. */
export function splitOutput(text: string): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const chunk = buffer.join("\n").replace(/^\n+|\s+$/g, "");
    if (chunk) blocks.push({ kind: "text", text: chunk });
    buffer = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const m = METER.exec(line);
    if (m?.[1] && m[2]) {
      flush();
      blocks.push({ kind: "meter", label: m[1].trim(), percent: Number(m[2].replace(",", ".")), note: m[3] ?? null });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}
