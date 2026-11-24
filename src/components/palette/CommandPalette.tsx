import { type ReactNode, useMemo, useState } from "react";
import {
  Brain,
  Keyboard,
  Settings,
  FolderGit2,
  LayoutDashboard,
  PanelRight,
  Plus,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { AgentLogo } from "@/components/ui/AgentLogo";
import {
  Command as CommandRoot,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatRelative } from "@/lib/format";
import { fuzzyScore, normalize } from "@/lib/fuzzy";
import { ipcErrorMessage } from "@/lib/ipc";
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
  const setOpen = useUi((s) => s.setPaletteOpen);
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Palette de commandes"
      description="Rechercher un chat, un projet ou une action"
      className="sm:max-w-xl"
    >
      {open && <PaletteContent />}
    </CommandDialog>
  );
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
        title: "Nouveau chat",
        subtitle: "Ouvrir un chat vide avec Claude",
        keywords: "nouveau chat créer lancer agent claude",
        icon: <Plus size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+N</CommandShortcut>,
        run: () => ui().startChat(null),
      },
      {
        id: "nav:home",
        group: "Navigation",
        title: "Accueil",
        subtitle: "Quotas, consommation et activité",
        keywords: "accueil home dashboard tableau de bord",
        icon: <LayoutDashboard size={15} />,
        run: () => ui().navigate({ kind: "home" }),
      },
      {
        id: "nav:memory",
        group: "Navigation",
        title: "Mémoire",
        subtitle: "Mémoire globale partagée par les agents (memory.md, MCP)",
        keywords: "mémoire memory souvenirs règles préférences profil mcp",
        icon: <Brain size={15} />,
        run: () => ui().navigate({ kind: "memory" }),
      },
      {
        id: "nav:settings",
        group: "Navigation",
        title: "Paramètres",
        subtitle: "Agents inactifs, agents & MCP, notifications, contexte injecté, CLI génériques",
        keywords: "paramètres settings préférences options notifications cli générique pty",
        icon: <Settings size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+,</CommandShortcut>,
        run: () => ui().openSettings(),
      },
      {
        id: "nav:shortcuts",
        group: "Navigation",
        title: "Raccourcis clavier",
        keywords: "raccourcis clavier shortcuts aide touches",
        icon: <Keyboard size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+/</CommandShortcut>,
        run: () => ui().setShortcutsOpen(true),
      },
      {
        id: "nav:dock",
        group: "Navigation",
        title: dockOpen ? "Masquer les threads live" : "Afficher les threads live",
        keywords: "dock threads live panneau",
        icon: <PanelRight size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+J</CommandShortcut>,
        run: () => ui().toggleDock(),
      },
    ];

    for (const t of threads) {
      const active = STATUS[t.status].active;
      list.push({
        id: `thread:${t.id}`,
        group: active ? "Chats actifs" : "Chats récents",
        title: t.title || "Chat sans titre",
        subtitle: [t.projectName, active ? describeStatus(t.status, t.detail) : formatRelative(t.updatedAt)]
          .filter(Boolean)
          .join(" · "),
        keywords: `${t.agent} ${t.model ?? ""}`,
        icon: active ? <StatusDot status={t.status} /> : <AgentLogo agent={t.agent} size={15} />,
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
        hint: <CommandShortcut className="tracking-normal">{p.threadCount} chats</CommandShortcut>,
        run: () => {
          ui().openProject(p.id, "context");
        },
      });
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

function PaletteContent() {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of results) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map.entries()];
  }, [results]);

  const run = (cmd: Command) => {
    setOpen(false);
    Promise.resolve(cmd.run()).catch((err: unknown) =>
      toast({ tone: "danger", title: "Commande échouée", description: ipcErrorMessage(err) }),
    );
  };

  return (
    <CommandRoot shouldFilter={false} loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Rechercher un chat, un projet, une action…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty className="animate-in fade-in-0 duration-150">Aucun résultat pour « {query} »</CommandEmpty>
        {groups.map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((cmd) => (
              <CommandItem key={cmd.id} value={cmd.id} onSelect={() => run(cmd)} className="animate-in fade-in-0 duration-150">
                {cmd.icon}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{cmd.title}</span>
                  {cmd.subtitle && <span className="truncate text-xs text-muted-foreground">{cmd.subtitle}</span>}
                </div>
                {cmd.hint}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandRoot>
  );
}
