export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Split `text` into parts, marking the first case-insensitive occurrence of `query` (trimmed).
 * Prefers a prefix match; otherwise marks the first substring occurrence.
 * Empty query or no match returns a single non-match part.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const trimmed = query.trim();
  if (trimmed.length === 0 || text.length === 0) {
    return [{ text, match: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const idx = lowerText.startsWith(lowerQuery) ? 0 : lowerText.indexOf(lowerQuery);
  if (idx === -1 || idx >= text.length) {
    return [{ text, match: false }];
  }

  const end = Math.min(idx + trimmed.length, text.length);
  const parts: HighlightPart[] = [];
  if (idx > 0) {
    parts.push({ text: text.slice(0, idx), match: false });
  }
  parts.push({ text: text.slice(idx, end), match: true });
  if (end < text.length) {
    parts.push({ text: text.slice(end), match: false });
  }
  return parts;
}
