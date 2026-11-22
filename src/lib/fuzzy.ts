/** Lowercase + strip diacritics, so "edition" matches "Édition". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Score `query` against `text` (already normalized). Returns null when it doesn't match.
 * Higher is better: contiguous substring > word-start subsequence > loose subsequence.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const idx = text.indexOf(query);
  if (idx !== -1) {
    const wordStart = idx === 0 || /[\s\-_/.:]/.test(text[idx - 1] ?? "");
    return 1000 - idx + (wordStart ? 200 : 0) - (text.length - query.length) * 0.5;
  }
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return null;
    const atWordStart = found === 0 || /[\s\-_/.:]/.test(text[found - 1] ?? "");
    score += found === prev + 1 ? 15 : atWordStart ? 10 : 1;
    prev = found;
    ti = found + 1;
  }
  return score - text.length * 0.1;
}
