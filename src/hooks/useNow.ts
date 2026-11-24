import { useSyncExternalStore } from "react";

/**
 * Shared clock: a single interval per period for the whole app, started only while at least one
 * component subscribes. Only the subscribing leaf components re-render on each tick.
 *
 * `subscribe` / `getSnapshot` are created once per clock: an inline `subscribe` made React unsubscribe and
 * resubscribe at every render, and a lone subscriber then restarted the clock (new `now`) during its own
 * commit → "Maximum update depth exceeded". The value is never changed synchronously inside `subscribe`.
 */
interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const clocks = new Map<number, Clock>();

function getClock(periodMs: number): Clock {
  const existing = clocks.get(periodMs);
  if (existing) return existing;

  const tick = () => {
    clock.now = Date.now();
    clock.listeners.forEach((l) => l());
  };
  const clock: Clock = {
    now: Date.now(),
    listeners: new Set(),
    timer: null,
    subscribe: (listener) => {
      clock.listeners.add(listener);
      if (!clock.timer) {
        clock.timer = setInterval(tick, periodMs);
        // The clock was idle: refresh it right after this commit (not during it).
        if (Date.now() - clock.now >= periodMs) setTimeout(tick, 0);
      }
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size === 0 && clock.timer) {
          clearInterval(clock.timer);
          clock.timer = null;
        }
      };
    },
    getSnapshot: () => clock.now,
  };
  clocks.set(periodMs, clock);
  return clock;
}

export function useNow(periodMs = 1000): number {
  const clock = getClock(periodMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
