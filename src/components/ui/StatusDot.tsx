import type { ThreadStatus } from "@/bindings/ThreadStatus";
import { STATUS, TONE_BG } from "@/lib/status";

/** Status indicator; pulses while the agent is working. Pair it with a text label. */
export function StatusDot({ status, className = "" }: { status: ThreadStatus; className?: string }) {
  const meta = STATUS[status];
  const bg = TONE_BG[meta.tone];
  return (
    <span className={`relative inline-flex size-2 shrink-0 ${className}`} aria-hidden>
      {meta.active && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${bg}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${bg}`} />
    </span>
  );
}
