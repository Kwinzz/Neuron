import { Fragment, useMemo } from "react";

interface HighlightedTextProps {
  text: string;
  query: string;
}

interface TextSegment {
  text: string;
  highlighted: boolean;
}

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSegments(text: string, query: string): TextSegment[] {
  const normalizedQuery = stripDiacritics(query);
  const rawWords = normalizedQuery.match(/[\p{L}\p{N}]+/gu);
  if (!rawWords || rawWords.length === 0) {
    return [{ text, highlighted: false }];
  }

  const words = Array.from(new Set(rawWords)).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(words.map(escapeRegExp).join("|"), "g");

  let normalizedText = "";
  const map: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    const norm = stripDiacritics(ch);
    for (let j = 0; j < norm.length; j += 1) {
      normalizedText += norm[j];
      map.push({ start: i, end: i + len });
    }
    i += len;
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of normalizedText.matchAll(pattern)) {
    const startIdx = match.index;
    const matchText = match[0];
    if (startIdx === undefined || matchText.length === 0) continue;
    const first = map[startIdx];
    const last = map[startIdx + matchText.length - 1];
    if (!first || !last) continue;

    const prev = ranges[ranges.length - 1];
    if (prev && first.start <= prev.end) {
      prev.end = Math.max(prev.end, last.end);
    } else {
      ranges.push({ start: first.start, end: last.end });
    }
  }

  if (ranges.length === 0) {
    return [{ text, highlighted: false }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), highlighted: false });
    }
    segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }
  return segments;
}

export function HighlightedText({ text, query }: HighlightedTextProps) {
  const segments = useMemo(() => buildSegments(text, query), [text, query]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark key={index} className="rounded-sm bg-accent px-0.5 text-hl">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
