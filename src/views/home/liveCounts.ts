import { STATUS } from "@/lib/status";
import type { LiveThread } from "@/stores/live";

export function countActive(threads: Record<string, LiveThread>): number {
  let count = 0;
  for (const t of Object.values(threads)) {
    if (STATUS[t.status].active) count += 1;
  }
  return count;
}

export function countAwaiting(threads: Record<string, LiveThread>): number {
  let count = 0;
  for (const t of Object.values(threads)) {
    if (t.status === "awaiting_approval") count += 1;
  }
  return count;
}
