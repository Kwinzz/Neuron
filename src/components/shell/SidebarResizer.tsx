import { type PointerEvent, useRef } from "react";
import { SidebarRail, useSidebar } from "@/components/ui/sidebar";
import { t } from "@/i18n";
import { useLayout } from "@/stores/layout";

/** Pointer travel (px) before a press on the rail counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/**
 * Right edge of the sidebar: drag to resize (200–440 px, remembered), click to collapse / expand.
 */
export function SidebarResizer() {
  const { state, toggleSidebar } = useSidebar();
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: useLayout.getState().sidebarWidth, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || state === "collapsed") return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      // No width transition while following the pointer, and no text selection / cursor flicker.
      document.documentElement.dataset.sidebarResizing = "";
    }
    useLayout.getState().setSidebarWidth(d.width + dx);
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      delete document.documentElement.dataset.sidebarResizing;
      useLayout.getState().saveSidebarWidth();
    } else {
      toggleSidebar();
    }
  };

  return (
    <SidebarRail
      aria-label={t("shell.resizeSidebar")}
      title={t("shell.resizeSidebarHint")}
      className="in-data-[side=left]:cursor-col-resize"
      onClick={undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
