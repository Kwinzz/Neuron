/** Relative change vs the previous period; null when there is nothing to compare against. */
export function computeDelta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return (cur - prev) / prev;
}
