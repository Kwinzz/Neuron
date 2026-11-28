import { useEffect, useState } from "react";
import { cn } from "cn";
import { Activity, ListX, PanelRightClose, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/separator";
import { useNow } from "@/hooks/useNow";
import { t } from "@/i18n";
import { STATUS } from "@/lib/status";
import { selectDockIds, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { DockCard } from "./dock/DockCard";
import { WindowControls } from "./WindowControls";

const DOCK_WIDTH = 380;

/** Ids of dock threads, optionally filtered by the selected project. */
function useDockIds(): string[] {
  const now = useNow(30_000);
  const projectId = useUi((s) => s.selectedProjectId);
  return useLive(
    useShallow((s) =>
      selectDockIds(s, now).filter(
        (id) =>
          projectId === null || (s.threads[id]?.projectId ?? s.threads[id]?.workspace?.projectId) === projectId,
      ),
    ),
  );
}

/** Right-hand live panel (inset card, mirrors the sidebar). Hidden when closed — toggle from the header. */
export function LiveDock() {
  const open = useUi((s) => s.dockOpen);
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => setRendered(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className="hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-snappy md:flex"
      style={{ width: open ? DOCK_WIDTH : 0 }}
    >
      {rendered && <DockPanel open={open} />}
    </div>
  );
}

function DockPanel({ open }: { open: boolean }) {
  const ids = useDockIds();
  const activeCount = useLive((s) => Object.values(s.threads).filter((t) => STATUS[t.status].active).length);
  const finishedIds = useLive(
    useShallow((s) => ids.filter((id) => s.threads[id] && !STATUS[s.threads[id].status].active)),
  );
  const projectId = useUi((s) => s.selectedProjectId);

  return (
    <aside
      className={cn(
        "m-2 flex shrink-0 flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-sm",
        "animate-in fade-in-0 slide-in-from-right-3 transition-[opacity,transform] duration-200 ease-snappy",
        open ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0",
      )}
      style={{ width: DOCK_WIDTH - 16 }}
      aria-label={t("shell.liveThreads")}
    >
      {/* Rightmost header while open: part of the title bar, holds the window controls. */}
      <header data-tauri-drag-region className="flex h-12 shrink-0 select-none items-center gap-2 pl-4 pr-2">
        <Activity className="size-4 text-muted-foreground" />
        <h2 data-tauri-drag-region className="text-sm font-medium">{t("shell.liveThreads")}</h2>
        {activeCount > 0 && (
          <Badge variant="secondary" className="font-mono tabular-nums animate-in zoom-in-75 fade-in-0 duration-200">
            {activeCount}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {finishedIds.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => useLive.getState().dismissFinishedFromDock(finishedIds)}
              aria-label={t("shell.dockClearFinished")}
              title={t("shell.dockClearFinished")}
            >
              <ListX className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => useUi.getState().toggleDock()}
            aria-label={t("shell.dockHide", { combo: `${MOD_LABEL}+J` })}
            title={t("shell.dockHide", { combo: `${MOD_LABEL}+J` })}
          >
            <PanelRightClose />
          </Button>
        </div>
        <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
        <WindowControls />
      </header>
      <Separator />

      {projectId && <ProjectFilterNote />}

      {/* Plain scroller on purpose: Radix ScrollArea wraps content in a `display: table` box that grows with
          the text, which defeats `truncate` and makes long titles overflow to the right. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 p-2">
          {ids.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 py-12 text-center animate-in fade-in-0 duration-200">
              <p className="text-sm font-medium">{t("shell.dockEmptyTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("shell.dockEmptyBody")}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {ids.map((id, i) => (
                <li
                  key={id}
                  className="min-w-0 animate-in fade-in-0 slide-in-from-right-2 duration-200 fill-mode-both"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <DockCard id={id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function ProjectFilterNote() {
  const projectId = useUi((s) => s.selectedProjectId);
  const name = useLive((s) => Object.values(s.threads).find((t) => t.projectId === projectId)?.projectName);
  return (
    <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <span className="min-w-0 flex-1 truncate">
        {t("shell.dockProjectFilter")} <span className="font-medium text-foreground">{name ?? t("shell.dockProjectSelected")}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        onClick={() => useUi.getState().selectProject(null)}
        aria-label={t("shell.dockClearFilter")}
      >
        <X />
      </Button>
    </div>
  );
}
