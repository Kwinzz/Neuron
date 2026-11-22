import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CornerDownLeft,
  Database,
  FlaskConical,
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  PanelRight,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatRelative } from "@/lib/format";
import { fuzzyScore, normalize } from "@/lib/fuzzy";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { STATUS, describeStatus } from "@/lib/status";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";

interface Command {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  /** Extra text matched by the search but not displayed. */
  keywords?: string;
  icon: ReactNode;
  hint?: ReactNode;
  run: () => void | Promise<void>;
}

const MAX_PER_GROUP_EMPTY = 6;
const MAX_RESULTS = 40;

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  return open ? <PaletteDialog /> : null;
}

function useCommands(): Command[] {
  const ui = useUi.getState;
  const dockOpen = useUi((s) => s.dockOpen);
  const projects = useDashboard((s) => s.snapshot?.projects);
  const threads = useLive(
    useShallow((s) => Object.values(s.threads).sort((a, b) => b.updatedAt - a.updatedAt)),
  );

  return useMemo(() => {
    const openThread = (id: string) => {
      ui().focusThread(id);
      ui().setDockOpen(true);
      useLive.getState().markSeen(id);
    };

    const list: Command[] = [
      {
        id: "thread:new",
        group: "Actions",
        title: "Nouveau thread",
        subtitle: "Lancer un agent dans un dossier",
        keywords: "nouveau chat créer lancer agent claude",
        icon: <Plus size={15} />,
        hint: (
          <span className="flex gap-1">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>N</Kbd>
          </span>
        ),
        run: () => ui().setNewThreadOpen(true),
      },
      {
        id: "nav:home",
        group: "Navigation",
        title: "Mission Control",
        subtitle: "Accueil, quotas et consommation",
        keywords: "accueil home dashboard tableau de bord",
        icon: <LayoutDashboard size={15} />,
        run: () => ui().navigate({ kind: "home" }),
      },
      {
        id: "nav:dock",
        group: "Navigation",
        title: dockOpen ? "Masquer le dock des threads" : "Afficher le dock des threads",
        keywords: "dock threads live panneau",
        icon: <PanelRight size={15} />,
        hint: (
          <span className="flex gap-1">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>J</Kbd>
          </span>
        ),
        run: () => ui().toggleDock(),
      },
    ];

    for (const t of threads) {
      const active = STATUS[t.status].active;
      list.push({
        id: `thread:${t.id}`,
        group: active ? "Threads actifs" : "Threads récents",
        title: t.title || "Thread sans titre",
        subtitle: [t.projectName, active ? describeStatus(t.status, t.detail) : formatRelative(t.updatedAt)]
          .filter(Boolean)
          .join(" · "),
        keywords: `${t.agent} ${t.model ?? ""}`,
        icon: active ? <StatusDot status={t.status} /> : <MessageSquare size={15} />,
        hint: <AgentBadge agent={t.agent} variant="short" className="text-xs" />,
        run: () => openThread(t.id),
      });
    }

    for (const p of projects ?? []) {
      list.push({
        id: `project:${p.id}`,
        group: "Projets",
        title: p.name,
        subtitle: p.path,
        icon: <FolderGit2 size={15} />,
        hint: <span className="font-mono text-[10px] tabular-nums text-fg-subtle">{p.threadCount} threads</span>,
        run: () => {
          ui().selectProject(p.id);
          ui().setDockOpen(true);
        },
      });
    }

    if (import.meta.env.DEV) {
      const reload = () => useDashboard.getState().load();
      list.push(
        {
          id: "dev:seed",
          group: "Développement",
          title: "Générer des données de démo",
          subtitle: "Projets, threads et 30 jours de consommation (préfixe demo-)",
          keywords: "seed demo fake",
          icon: <Database size={15} />,
          run: async () => {
            const rows = await ipc.dev.seedDemo();
            useLive.setState({ threads: {}, attention: {} });
            await reload();
            toast({ tone: "ok", title: "Données de démo générées", description: `${rows} relevés de consommation` });
          },
        },
        {
          id: "dev:simulate",
          group: "Développement",
          title: "Simuler de l'activité live",
          subtitle: "Émet des événements agent://event pendant ~30 s",
          keywords: "simulate events live",
          icon: <FlaskConical size={15} />,
          run: async () => {
            const n = await ipc.dev.simulateActivity();
            toast({ tone: "info", title: "Simulation lancée", description: `${n} thread(s) actif(s)` });
          },
        },
        {
          id: "dev:clear",
          group: "Développement",
          title: "Supprimer les données de démo",
          keywords: "clear demo reset",
          icon: <Trash2 size={15} />,
          run: async () => {
            await ipc.dev.clearDemo();
            useLive.setState({ threads: {}, attention: {} });
            await reload();
            toast({ tone: "ok", title: "Données de démo supprimées" });
          },
        },
      );
    }
    return list;
  }, [dockOpen, projects, threads, ui]);
}

function filterCommands(commands: Command[], query: string): Command[] {
  const q = normalize(query.trim());
  if (!q) {
    const perGroup = new Map<string, number>();
    return commands.filter((c) => {
      const n = perGroup.get(c.group) ?? 0;
      perGroup.set(c.group, n + 1);
      return n < MAX_PER_GROUP_EMPTY;
    });
  }
  return commands
    .map((c) => {
      const titleScore = fuzzyScore(q, normalize(c.title));
      const restScore = fuzzyScore(q, normalize(`${c.subtitle ?? ""} ${c.keywords ?? ""} ${c.group}`));
      const score = Math.max(titleScore ?? -Infinity, restScore === null ? -Infinity : restScore - 300);
      return { c, score };
    })
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((r) => r.c);
}

function PaletteDialog() {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  // Keep group headers in result order.
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of results) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map.entries()];
  }, [results]);
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);
  const current = Math.min(index, Math.max(0, flat.length - 1));

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const close = () => setOpen(false);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    Promise.resolve(cmd.run()).catch((err: unknown) =>
      toast({ tone: "danger", title: "Commande échouée", description: ipcErrorMessage(err) }),
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setIndex((current + 1) % Math.max(1, flat.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setIndex((current - 1 + flat.length) % Math.max(1, flat.length));
        break;
      case "Enter":
        e.preventDefault();
        run(flat[current]);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  };

  let i = -1;
  return (
    <div
      className="fade-in fixed inset-0 z-40 flex items-start justify-center bg-bg/60 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        className="glass-overlay pop-in flex max-h-[min(580px,72vh)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden shadow-2xl shadow-black/60"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <Search size={18} className="text-hl" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Rechercher un thread, un projet, une action…"
            className="h-full flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[current] ? `palette-${flat[current].id}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="flex-1 overflow-y-auto p-2">
          {flat.length === 0 && (
            <p className="px-3 py-8 text-center text-fg-muted">Aucun résultat pour « {query} »</p>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="pb-1">
              <div className="px-3 pb-1.5 pt-2.5 text-xs font-bold uppercase tracking-wide text-fg-muted">{group}</div>
              {items.map((cmd) => {
                i += 1;
                const idx = i;
                const selected = idx === current;
                return (
                  <div
                    key={cmd.id}
                    id={`palette-${cmd.id}`}
                    role="option"
                    aria-selected={selected}
                    data-index={idx}
                    onMouseMove={() => idx !== current && setIndex(idx)}
                    onClick={() => run(cmd)}
                    className={`flex h-12 cursor-default items-center gap-3 rounded-[15px] px-2.5 ${
                      selected ? "bg-surface text-fg" : "text-fg-muted"
                    }`}
                  >
                    <IconBox tone={selected ? "brand" : "muted"} size={30}>
                      {cmd.icon}
                    </IconBox>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-bold text-fg">{cmd.title}</span>
                      {cmd.subtitle && <span className="truncate text-xs text-fg-muted">{cmd.subtitle}</span>}
                    </span>
                    {cmd.hint && <span className="shrink-0">{cmd.hint}</span>}
                    {selected && <CornerDownLeft size={13} className="shrink-0 text-fg-subtle" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex h-10 shrink-0 items-center gap-3 border-t border-line px-5 text-[11px] text-fg-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> naviguer
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> ouvrir
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Activity size={11} /> {flat.length} résultat{flat.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
