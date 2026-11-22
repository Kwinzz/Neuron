import { type ReactNode, useEffect, useState } from "react";
import { FolderGit2, Keyboard, LayoutDashboard } from "lucide-react";
import type { AppInfo } from "@/bindings/AppInfo";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useUi } from "@/stores/ui";

/** Floating Vision sidebar: wordmark, navigation, projects, shortcuts card. */
export function Sidebar() {
  const view = useUi((s) => s.view);
  const navigate = useUi((s) => s.navigate);

  return (
    <nav className="glass-panel flex h-full w-[260px] shrink-0 flex-col px-4" aria-label="Navigation">
      <div className="flex h-[76px] shrink-0 items-center justify-center gap-2.5">
        <span className="size-2 rounded-full bg-accent-2 shadow-[0_0_12px_var(--color-accent-2)]" aria-hidden />
        <span className="text-wordmark text-sm font-bold uppercase tracking-[3px]">Neuron</span>
      </div>
      <div className="mb-5 h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent" aria-hidden />

      <ul className="flex flex-col gap-1.5">
        <li>
          <NavItem
            icon={<LayoutDashboard size={15} />}
            label="Mission Control"
            active={view.kind === "home"}
            onClick={() => navigate({ kind: "home" })}
          />
        </li>
      </ul>

      <ProjectList />

      <ShortcutsCard />
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  trailing,
  title,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-[15px] py-2.5 pe-3 ps-3 text-sm font-bold transition-colors duration-fast ${
        active ? "bg-surface text-fg" : "text-fg hover:bg-surface/50"
      }`}
    >
      <IconBox tone={active ? "brand" : "muted"} size={30}>
        {icon}
      </IconBox>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

function ProjectList() {
  const projects = useDashboard((s) => s.snapshot?.projects);
  const selected = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const setDockOpen = useUi((s) => s.setDockOpen);

  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col">
      <h3 className="px-3 pb-2 text-xs font-bold uppercase tracking-wide text-fg">Projets</h3>
      <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {projects?.length === 0 && <li className="px-3 py-1 text-xs text-fg-muted">Aucun projet pour l'instant.</li>}
        {projects?.map((p) => {
          const active = selected === p.id;
          return (
            <li key={p.id}>
              <NavItem
                icon={<FolderGit2 size={15} />}
                label={p.name}
                active={active}
                title={`${p.path}\nFiltrer le dock sur ce projet`}
                onClick={() => {
                  selectProject(active ? null : p.id);
                  if (!active) setDockOpen(true);
                }}
                trailing={
                  p.activeCount > 0 ? (
                    <span
                      className="flex items-center gap-1 rounded-full bg-accent-2/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-accent-2"
                      title={`${p.activeCount} thread(s) actif(s)`}
                    >
                      <span className="size-1.5 animate-pulse rounded-full bg-accent-2" />
                      {p.activeCount}
                    </span>
                  ) : (
                    <span className="text-xs font-bold tabular-nums text-fg-subtle" title={`${p.threadCount} thread(s)`}>
                      {p.threadCount}
                    </span>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShortcutsCard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  useEffect(() => {
    ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  return (
    <div className="mb-4 mt-4 shrink-0 overflow-hidden rounded-xl bg-[radial-gradient(120%_120%_at_0%_0%,var(--color-brand)_0%,transparent_65%),linear-gradient(135deg,var(--color-brand-active),var(--color-bg-sunken))] p-4">
      <IconBox tone="muted" size={36} className="bg-white text-brand">
        <Keyboard size={18} />
      </IconBox>
      <p className="mt-3 text-sm font-bold text-fg">Tout au clavier</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs text-fg/80">
        <li className="flex items-center gap-1">
          <Kbd>{MOD_LABEL}</Kbd>
          <Kbd>K</Kbd>
          <span className="ml-1">Palette</span>
        </li>
        <li className="flex items-center gap-1">
          <Kbd>{MOD_LABEL}</Kbd>
          <Kbd>J</Kbd>
          <span className="ml-1">Threads live</span>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mt-3 h-9 w-full rounded-md bg-bg-sunken/80 text-xs font-bold text-fg transition-colors duration-fast hover:bg-bg-sunken"
      >
        Ouvrir la palette
      </button>
      <p className="mt-3 flex items-center justify-between text-[10px] font-bold text-fg/60">
        <span>SQLite v{info?.schemaVersion ?? "–"}</span>
        <span className="tabular-nums">v{info?.version ?? "–"}</span>
      </p>
    </div>
  );
}
