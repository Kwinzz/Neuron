/**
 * Structural equality for plain IPC data (objects, arrays, primitives). Used to keep the previous object when a
 * refresh brings the same data: zustand selectors then see no change and nothing re-renders.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  const ra = a as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameValue(ra[k], rb[k]));
}

/** `next` unless it equals `prev`, in which case `prev` (keeps references stable). */
export function keepIfSame<T>(prev: T | undefined, next: T): T {
  return prev !== undefined && sameValue(prev, next) ? prev : next;
}
