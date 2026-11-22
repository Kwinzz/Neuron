import {
  Ban,
  Brain,
  CheckCircle2,
  Circle,
  FilePen,
  FileSearch,
  type LucideIcon,
  Power,
  ShieldAlert,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import type { ThreadStatus } from "@/bindings/ThreadStatus";
import { STATUS, type StatusTone } from "@/lib/status";
import { IconBox } from "./IconBox";

const ICON: Record<ThreadStatus, LucideIcon> = {
  idle: Circle,
  starting: Power,
  thinking: Brain,
  reading: FileSearch,
  editing: FilePen,
  running: SquareTerminal,
  awaiting_approval: ShieldAlert,
  done: CheckCircle2,
  error: XCircle,
  cancelled: Ban,
};

const TONE: Record<StatusTone, "cyan" | "warn" | "ok" | "danger" | "muted"> = {
  live: "cyan",
  pending: "cyan",
  warn: "warn",
  ok: "ok",
  danger: "danger",
  muted: "muted",
};

/** Icon box whose glyph and tint reflect a thread status (pair with a text label). */
export function StatusIconBox({ status, size = 30 }: { status: ThreadStatus; size?: 30 | 36 }) {
  const Icon = ICON[status];
  return (
    <IconBox tone={TONE[STATUS[status].tone]} size={size}>
      <Icon size={size === 30 ? 15 : 17} strokeWidth={2} />
    </IconBox>
  );
}
