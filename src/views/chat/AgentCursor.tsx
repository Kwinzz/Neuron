import { type RefObject, memo, useEffect, useRef } from "react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import { AgentLogo } from "@/components/ui/AgentLogo";

/** Height of one text line (leading-7): the cursor sits on the last line of the last element. */
const LINE = 28;

interface AgentCursorProps {
  /** Timeline column; the cursor lives in its left gutter (`pl-10`). */
  containerRef: RefObject<HTMLElement | null>;
  agent: AgentKind;
  visible: boolean;
}

/** Bottom line of the latest element of the conversation (text line, shell/code block, "Working" row…). */
function targetY(container: HTMLElement, self: HTMLElement): number {
  let last = container.lastElementChild as HTMLElement | null;
  while (last && last === self) last = last.previousElementSibling as HTMLElement | null;
  if (!last) return 0;
  return Math.max(last.offsetTop, last.offsetTop + last.offsetHeight - LINE);
}

/**
 * The agent's logo, gliding down the left gutter as the answer grows — whatever appears (text lines,
 * code blocks, shell blocks, permission cards). A critically-damped spring driven by rAF writes the
 * transform directly (no React re-render per frame), so big jumps (a code block landing) stay fluid.
 */
export const AgentCursor = memo(function AgentCursor({ containerRef, agent, visible }: AgentCursorProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const pos = useRef({ y: 0, v: 0, placed: false });

  useEffect(() => {
    const el = ref.current;
    const container = containerRef.current;
    if (!el || !container || !visible) return;

    const state = pos.current;
    if (!state.placed) {
      // First appearance: start on the target, don't fly in from the top.
      state.y = targetY(container, el);
      state.v = 0;
      state.placed = true;
    }
    let frame = 0;
    const tick = () => {
      const target = targetY(container, el);
      const accel = (target - state.y) * 0.16;
      state.v = (state.v + accel) * 0.68;
      state.y += state.v;
      if (Math.abs(target - state.y) < 0.25 && Math.abs(state.v) < 0.25) {
        state.y = target;
        state.v = 0;
      }
      el.style.transform = `translate3d(0, ${state.y}px, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [containerRef, visible]);

  // Next appearance (next turn) starts again from its target.
  useEffect(() => {
    if (!visible) pos.current.placed = false;
  }, [visible]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-10 transition-opacity duration-300 will-change-transform",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <span className="chat-working-logo flex size-7 items-center justify-center rounded-lg border bg-card">
        <AgentLogo agent={agent} size={15} />
      </span>
    </span>
  );
});
