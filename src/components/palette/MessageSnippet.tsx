import { Fragment, useMemo } from "react";

interface SnippetPart {
  text: string;
  match: boolean;
}

const MATCH_START = "\u0002";
const MATCH_END = "\u0003";

/**
 * Parse a `MessageHit.snippet` where matched terms are wrapped between `\u{2}` and `\u{3}`
 * (see `src/bindings/MessageHit.ts`), collapsing multi-line whitespace for compact display.
 */
function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let i = 0;
  while (i < snippet.length) {
    const start = snippet.indexOf(MATCH_START, i);
    if (start === -1) {
      const rest = snippet.slice(i).replaceAll(MATCH_END, "").replace(/\s+/g, " ");
      if (rest) parts.push({ text: rest, match: false });
      break;
    }
    if (start > i) {
      const before = snippet.slice(i, start).replaceAll(MATCH_END, "").replace(/\s+/g, " ");
      if (before) parts.push({ text: before, match: false });
    }
    const end = snippet.indexOf(MATCH_END, start + 1);
    if (end === -1) {
      const rest = snippet.slice(start + 1).replace(/\s+/g, " ");
      if (rest) parts.push({ text: rest, match: true });
      break;
    }
    const matched = snippet.slice(start + 1, end).replace(/\s+/g, " ");
    if (matched) parts.push({ text: matched, match: true });
    i = end + 1;
  }
  return parts;
}

export function MessageSnippet({ snippet }: { snippet: string }) {
  const parts = useMemo(() => parseSnippet(snippet), [snippet]);

  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-xs bg-primary/15 px-0.5 font-medium text-hl">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
