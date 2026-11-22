import { Activity, PanelRightClose, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNow } from "@/hooks/useNow";
import { STATUS } from "@/lib/status";
import { selectDockIds, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { DockThreadRow } from "./DockThreadRow";

/** Ids of dock threads, optionally filtered by the selected project. */
function useDockIds(): string[] {
  const now = useNow(30_000);
  const projectId = useUi((s) => s.selectedProjectId);
  return useLive(
    useShallow((s) =>
      selectDockIds(s, now).filter((id) => projectId === null || s.threads[id]?.projectId === projectId),
    ),
  );
}

/** Right-hand live panel (inset card, mirrors the sidebar). Hidden when closed — toggle from the header. */
export function LiveDock() {
  const open = useUi((s) => s.dockOpen);
  if (!open) return null;
  return <DockPanel />;
}

function DockPanel() {
  const ids = useDockIds();
  const activeCount = useLive((s) => Object.values(s.threads).filter((t) => STATUS[t.status].active).length);
  const projectId = useUi((s) => s.selectedProjectId);

  return (
    <aside
      className="m-2 hidden w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-sm md:flex"
      aria-label="Threads en cours"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Threads live</h2>
        {activeCount > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {activeCount}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => useUi.getState().toggleDock()}
          title={`Masquer (${MOD_LABEL}+J)`}
        >
          <PanelRightClose />
        </Button>
      </header>
      <Separator />

      {projectId && <ProjectFilterNote />}

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {ids.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
              <p className="text-sm font-medium">Aucun thread actif</p>
              <p className="text-xs text-muted-foreground">
                Les chats en cours, tous projets confondus, apparaissent ici en temps réel.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {ids.map((id) => (
                <li key={id}>
                  <DockThreadRow id={id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function ProjectFilterNote() {
  const projectId = useUi((s) => s.selectedProjectId);
  const name = useLive((s) => Object.values(s.threads).find((t) => t.projectId === projectId)?.projectName);
  return (
    <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        Projet : <span className="font-medium text-foreground">{name ?? "sélectionné"}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        onClick={() => useUi.getState().selectProject(null)}
        aria-label="Retirer le filtre projet"
      >
        <X />
      </Button>
    </div>
  );
}
