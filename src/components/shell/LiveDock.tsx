import { Activity, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
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

/** Persistent right dock listing every live thread across projects. */
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
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-line bg-bg" aria-label="Threads en cours">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Activity size={14} className="text-fg-subtle" />
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Threads live</h2>
        <span className="font-mono text-[10px] tabular-nums text-accent">{activeCount > 0 ? activeCount : ""}</span>
        <button
          type="button"
          onClick={toggleDock}
          className="ml-auto flex items-center gap-1.5 rounded-sm p-1 text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg"
          title={`Masquer (${MOD_LABEL}+J)`}
        >
          <PanelRightClose size={14} />
        </button>
      </header>

      {projectId && <ProjectFilterNote />}

      <div className="flex-1 overflow-y-auto p-2">
        {ids.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-fg-muted">Aucun thread actif</p>
            <p className="text-xs text-fg-subtle">
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

      <footer className="flex h-8 shrink-0 items-center gap-1.5 border-t border-line px-3 text-[10px] text-fg-subtle">
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
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-muted">
      <span className="min-w-0 flex-1 truncate">
        Filtré : <span className="text-fg">{name ?? "projet"}</span>
      </span>
      <button
        type="button"
        onClick={() => selectProject(null)}
        className="text-fg-subtle transition-colors duration-fast hover:text-fg"
      >
        Tout afficher
      </button>
    </div>
  );
}

/** Collapsed dock: thin rail with live indicators and the attention badge. */
function DockRail() {
  const agents = useActiveAgents();
  const attentionCount = useLive((s) => Object.keys(s.attention).length);
  const toggleDock = useUi((s) => s.toggleDock);

  return (
    <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l border-line bg-bg py-3" aria-label="Threads en cours (réduit)">
      <button
        type="button"
        onClick={toggleDock}
        className="relative rounded-sm p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg"
        title={`Afficher les threads (${MOD_LABEL}+J)`}
      >
        <PanelRightOpen size={15} />
        {attentionCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 font-mono text-[9px] font-semibold tabular-nums text-accent-fg">
            {attentionCount}
          </span>
        )}
      </button>
      <div className="flex flex-col items-center gap-1.5" title={`${agents.length} thread(s) actif(s)`}>
        {agents.map((agent, i) => (
          <span key={i} className={`size-1.5 animate-pulse rounded-[2px] ${AGENTS[agent].bg}`} />
        ))}
      </div>
    </aside>
  );
}
