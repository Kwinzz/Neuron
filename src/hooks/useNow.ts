import { useSyncExternalStore } from "react";

/**
 * Shared clock: a single interval per period for the whole app, started only while at least one
 * component subscribes. Only the subscribing leaf components re-render on each tick.
 */
const clocks = new Map<number, { now: number; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null }>();

function getClock(periodMs: number) {
  let clock = clocks.get(periodMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: null };
    clocks.set(periodMs, clock);
  }
  return clock;
}

export function useNow(periodMs = 1000): number {
  const clock = getClock(periodMs);
  return useSyncExternalStore(
    (listener) => {
      clock.listeners.add(listener);
      if (!clock.timer) {
        clock.now = Date.now();
        clock.timer = setInterval(() => {
          clock.now = Date.now();
          clock.listeners.forEach((l) => l());
        }, periodMs);
      }
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size === 0 && clock.timer) {
          clearInterval(clock.timer);
          clock.timer = null;
        }
      };
    },
    () => clock.now,
  );
}
