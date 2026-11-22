import { Activity, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { useNow } from "@/hooks/useNow";
import { AGENTS } from "@/lib/agents";
import { STATUS } from "@/lib/status";
import { selectDockIds, useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { DockThreadRow } from "./DockThreadRow";

/** Ids of dock threads, optionally filtered by the selected project. */
function useDockIds(): string[] {
  const now = useNow(30_000); // re-evaluate lingering finished threads periodically
  const projectId = useUi((s) => s.selectedProjectId);
  return useLive(
    useShallow((s) =>
      selectDockIds(s, now).filter((id) => projectId === null || s.threads[id]?.projectId === projectId),
    ),
  );
}

function useActiveAgents() {
  return useLive(
    useShallow((s) =>
      Object.values(s.threads)
        .filter((t) => STATUS[t.status].active)
        .map((t) => t.agent),
    ),
  );
}

/** Floating right dock listing every live thread across projects. */
export function LiveDock() {
  const open = useUi((s) => s.dockOpen);
  return open ? <DockPanel /> : <DockRail />;
}

function DockPanel() {
  const ids = useDockIds();
  const activeCount = useActiveAgents().length;
  const projectId = useUi((s) => s.selectedProjectId);
  const toggleDock = useUi((s) => s.toggleDock);

  return (
    <aside className="glass-card flex h-full w-[310px] shrink-0 flex-col rounded-lg" aria-label="Threads en cours">
      <header className="flex h-[76px] shrink-0 items-center gap-3 px-4">
        <IconBox tone="brand" size={30}>
          <Activity size={15} />
        </IconBox>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-fg">Threads live</h2>
          <p className="text-xs text-fg-muted">
            {activeCount > 0 ? `${activeCount} en cours` : "Aucun en cours"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleDock}
          className="rounded-md p-2 text-fg-muted transition-colors duration-fast hover:bg-surface hover:text-fg"
          title={`Masquer (${MOD_LABEL}+J)`}
        >
          <PanelRightClose size={16} />
        </button>
      </header>
      <div className="mx-4 h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent" aria-hidden />

      {projectId && <ProjectFilterNote />}

      <div className="flex-1 overflow-y-auto p-2">
        {ids.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-sm font-bold text-fg">Aucun thread actif</p>
            <p className="text-xs text-fg-muted">
              Les threads en cours, tous projets confondus, apparaissent ici en temps réel.
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

      <footer className="flex h-11 shrink-0 items-center gap-1.5 px-4 text-[11px] text-fg-muted">
        <Kbd>{MOD_LABEL}</Kbd>
        <Kbd>J</Kbd>
        <span>afficher / masquer</span>
      </footer>
    </aside>
  );
}

function ProjectFilterNote() {
  const projectId = useUi((s) => s.selectedProjectId);
  const name = useLive((s) => Object.values(s.threads).find((t) => t.projectId === projectId)?.projectName);
  const selectProject = useUi((s) => s.selectProject);
  return (
    <div className="mx-3 mt-3 flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-xs text-fg-muted">
      <span className="min-w-0 flex-1 truncate">
        Projet : <span className="font-bold text-fg">{name ?? "sélectionné"}</span>
      </span>
      <button
        type="button"
        onClick={() => selectProject(null)}
        aria-label="Retirer le filtre projet"
        className="rounded-sm p-0.5 text-fg-muted transition-colors duration-fast hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Collapsed dock: slim rail with live indicators and the attention badge. */
function DockRail() {
  const agents = useActiveAgents();
  const attentionCount = useLive((s) => Object.keys(s.attention).length);
  const toggleDock = useUi((s) => s.toggleDock);

  return (
    <aside
      className="glass-card flex h-full w-14 shrink-0 flex-col items-center gap-4 rounded-lg py-5"
      aria-label="Threads en cours (réduit)"
    >
      <button
        type="button"
        onClick={toggleDock}
        className="relative flex size-[30px] items-center justify-center rounded-md bg-surface text-hl transition-colors duration-fast hover:bg-surface-hover"
        title={`Afficher les threads (${MOD_LABEL}+J)`}
      >
        <PanelRightOpen size={15} />
        {attentionCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[9px] font-bold tabular-nums text-bg">
            {attentionCount}
          </span>
        )}
      </button>
      <div className="flex flex-col items-center gap-2" title={`${agents.length} thread(s) actif(s)`}>
        {agents.map((agent, i) => (
          <span key={i} className={`size-2 animate-pulse rounded-[3px] ${AGENTS[agent].bg}`} />
        ))}
      </div>
    </aside>
  );
}
