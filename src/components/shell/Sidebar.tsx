import { type ReactNode, useEffect, useState } from "react";
import { FolderGit2, LayoutDashboard, Search } from "lucide-react";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import type { AppInfo } from "@/bindings/AppInfo";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useUi } from "@/stores/ui";

export function Sidebar() {
  const togglePalette = useUi((s) => s.togglePalette);
  const view = useUi((s) => s.view);
  const navigate = useUi((s) => s.navigate);

  return (
    <nav className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-bg-sunken" aria-label="Navigation">
      <div className="flex h-11 shrink-0 items-center gap-2.5 px-4">
        <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" aria-hidden />
        <span className="text-sm font-medium tracking-tight text-fg">Neuron</span>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={togglePalette}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-fg-subtle transition-colors duration-fast hover:border-line-strong hover:text-fg-muted"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Rechercher…</span>
          <Kbd>{MOD_LABEL}</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>

      <ul className="flex flex-col gap-px px-2">
        <li>
          <NavItem
            icon={<LayoutDashboard size={14} />}
            label="Mission Control"
            active={view.kind === "home"}
            onClick={() => navigate({ kind: "home" })}
          />
        </li>
      </ul>

      <ProjectList />

      <SidebarFooter />
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 transition-colors duration-fast ${
        active ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
      }`}
    >
      <span className={active ? "text-accent" : "text-fg-subtle"}>{icon}</span>
      {label}
    </button>
  );
}

function ProjectList() {
  const projects = useDashboard((s) => s.snapshot?.projects);
  const selected = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const setDockOpen = useUi((s) => s.setDockOpen);

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <h3 className="px-4 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Projets</h3>
      <ul className="flex min-h-0 flex-col gap-px overflow-y-auto px-2">
        {projects?.length === 0 && (
          <li className="px-2.5 py-1 text-xs text-fg-subtle">Aucun projet pour l'instant.</li>
        )}
        {projects?.map((p) => {
          const active = selected === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                title={`${p.path}\nFiltrer le dock sur ce projet`}
                onClick={() => {
                  selectProject(active ? null : p.id);
                  if (!active) setDockOpen(true);
                }}
                aria-pressed={active}
                className={`flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 transition-colors duration-fast ${
                  active ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
                }`}
              >
                <FolderGit2 size={14} className={active ? "text-accent" : "text-fg-subtle"} />
                <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                {p.activeCount > 0 ? (
                  <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-accent" title={`${p.activeCount} actif(s)`}>
                    <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                    {p.activeCount}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] tabular-nums text-fg-subtle">{p.threadCount}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SidebarFooter() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-4 font-mono text-[10px] text-fg-subtle">
      <span className="size-1.5 rounded-full bg-ok" aria-hidden />
      <span>SQLite v{info?.schemaVersion ?? "–"}</span>
      <span className="ml-auto tabular-nums">v{info?.version ?? "–"}</span>
    </div>
  );
}
