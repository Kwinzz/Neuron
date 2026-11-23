import { type ComponentProps, memo, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Settings,
  ChevronRight,
  CirclePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MOD_LABEL } from "@/components/ui/Kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { StatusDot } from "@/components/ui/StatusDot";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { STATUS } from "@/lib/status";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import neuronMark from "@/assets/neuron-mark.png";
import { SidebarResizer } from "./SidebarResizer";

/** Chats shown per project folder / in the loose "Chats" list before "Afficher plus". */
const PAGE = 8;

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  useEffect(() => {
    void useNav.getState().load();
  }, []);

  return (
    <Sidebar {...props}>
      <SidebarHeader data-tauri-drag-region>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => useUi.getState().navigate({ kind: "home" })}
              tooltip="Neuron"
              className="justify-center gap-2"
            >
              {/* App mark without its black tile: the glyph is a mask painted in the text color. */}
              <span
                aria-hidden
                className="size-5 shrink-0 bg-foreground"
                style={{ mask: `url(${neuronMark}) center / contain no-repeat` }}
              />
              <span className="truncate text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Neuron
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <MainNav />
        <ProjectsNav />
        <LooseChatsNav />
      </SidebarContent>

      <SidebarResizer />
    </Sidebar>
  );
}

function MainNav() {
  const isHome = useUi((s) => s.view.kind === "home");
  const isMemory = useUi((s) => s.view.kind === "memory");
  const isSettings = useUi((s) => s.view.kind === "settings");
  const isDraft = useUi((s) => s.view.kind === "draft" && s.view.projectId === null);
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={`Nouveau chat (${MOD_LABEL}+N)`}
              isActive={isDraft}
              onClick={() => useUi.getState().startChat(null)}
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            >
              <CirclePlus />
              <span>Nouveau chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Accueil" isActive={isHome} onClick={() => useUi.getState().navigate({ kind: "home" })}>
              <Home />
              <span>Accueil</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Mémoire" isActive={isMemory} onClick={() => useUi.getState().navigate({ kind: "memory" })}>
              <Brain />
              <span>Mémoire</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={`Paramètres (${MOD_LABEL}+,)`} isActive={isSettings} onClick={() => useUi.getState().openSettings()}>
              <Settings />
              <span>Paramètres</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={`Rechercher (${MOD_LABEL}+K)`} onClick={() => useUi.getState().setPaletteOpen(true)}>
              <Search />
              <span>Rechercher</span>
            </SidebarMenuButton>
            <SidebarMenuBadge className="text-muted-foreground">{MOD_LABEL}+K</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Chats grouped by project id ("" = no project), newest first. */
function useChatsByProject(): Map<string, ThreadSummary[]> {
  const chats = useNav((s) => s.chats);
  return useMemo(() => {
    const map = new Map<string, ThreadSummary[]>();
    for (const c of chats) {
      const key = c.projectId ?? "";
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [chats]);
}

async function addProject() {
  try {
    const path = await ipc.pickDirectory();
    if (!path) return;
    const projects = await ipc.createProject(path);
    useNav.getState().setProjects(projects);
    const created = projects.find((p) => p.path === path);
    if (created) useNav.getState().setProjectOpen(created.id, true);
    void useDashboard.getState().load();
  } catch (err) {
    toast({ tone: "danger", title: "Projet non ajouté", description: ipcErrorMessage(err) });
  }
}

function ProjectsNav() {
  const projects = useNav((s) => s.projects);
  const byProject = useChatsByProject();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projets</SidebarGroupLabel>
      <SidebarGroupAction title="Ajouter un projet (dossier)" onClick={() => void addProject()}>
        <FolderPlus />
        <span className="sr-only">Ajouter un projet</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {projects.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void addProject()} className="text-muted-foreground">
              <FolderPlus />
              <span>Ajouter un dossier…</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {projects.map((p) => (
          <ProjectFolder key={p.id} project={p} chats={byProject.get(p.id) ?? EMPTY} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

const EMPTY: ThreadSummary[] = [];

const ProjectFolder = memo(function ProjectFolder({ project, chats }: { project: ProjectSummary; chats: ThreadSummary[] }) {
  const open = useNav((s) => s.openProjects[project.id] ?? false);
  const [showAll, setShowAll] = useState(false);
  const draftHere = useUi((s) => s.view.kind === "draft" && s.view.projectId === project.id);
  const pageHere = useUi((s) => s.view.kind === "project" && s.view.id === project.id);
  const activeCount = useLive((s) => chats.filter((c) => STATUS[s.threads[c.id]?.status ?? c.status].active).length);
  const visible = showAll ? chats : chats.slice(0, PAGE);

  const remove = async () => {
    try {
      useNav.getState().setProjects(await ipc.deleteProject(project.id));
      void useNav.getState().load();
      void useDashboard.getState().load();
    } catch (err) {
      toast({ tone: "danger", title: "Projet non retiré", description: ipcErrorMessage(err) });
    }
  };

  return (
    <Collapsible asChild open={open} onOpenChange={(o) => useNav.getState().setProjectOpen(project.id, o)}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={project.path}>
            <ChevronRight
              className={`size-3.5! text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
            {open ? <FolderOpen /> : <Folder />}
            <span>{project.name}</span>
            {activeCount > 0 && (
              <span className="ml-auto flex items-center gap-1 text-xs text-live tabular-nums transition-opacity duration-150 group-hover/menu-item:opacity-0 animate-in fade-in-0 zoom-in-75 animation-duration-200">
                <span className="size-1.5 animate-pulse rounded-full bg-live" />
                {activeCount}
              </span>
            )}
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
              <MoreHorizontal />
              <span className="sr-only">Actions du projet</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuItem onClick={() => useUi.getState().startChat(project.id)}>
              <Plus />
              Nouveau chat ici
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => useUi.getState().openProject(project.id, "context")}>
              <FileText />
              Contexte du projet
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                useUi.getState().selectProject(project.id);
                useUi.getState().setDockOpen(true);
              }}
            >
              <MessageSquare />
              Filtrer le dock sur ce projet
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
              <Trash2 />
              Retirer le projet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                isActive={draftHere}
                onClick={() => useUi.getState().startChat(project.id)}
                className="text-muted-foreground"
              >
                <Plus />
                <span>Nouveau chat</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                isActive={pageHere}
                onClick={() => useUi.getState().openProject(project.id, "context")}
                className="text-muted-foreground"
              >
                <FileText />
                <span>Contexte & projet</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {visible.map((c, i) => (
              <SidebarMenuSubItem
                key={c.id}
                className="animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-200"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                <ChatLink chat={c} sub />
              </SidebarMenuSubItem>
            ))}
            {chats.length > PAGE && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
                  <span>{showAll ? "Afficher moins" : `Afficher ${chats.length - PAGE} de plus`}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
});

function LooseChatsNav() {
  const byProject = useChatsByProject();
  const chats = byProject.get("") ?? EMPTY;
  const [showAll, setShowAll] = useState(false);
  if (chats.length === 0) return null;
  const visible = showAll ? chats : chats.slice(0, PAGE);
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarMenu>
        {visible.map((c, i) => (
          <SidebarMenuItem
            key={c.id}
            className="animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-200"
            style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
          >
            <ChatLink chat={c} />
          </SidebarMenuItem>
        ))}
        {chats.length > PAGE && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
              <span>{showAll ? "Afficher moins" : `Afficher ${chats.length - PAGE} de plus`}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** A chat entry; title and status come from the live store when available. */
const ChatLink = memo(function ChatLink({ chat, sub = false }: { chat: ThreadSummary; sub?: boolean }) {
  const title = useLive((s) => s.threads[chat.id]?.title ?? chat.title);
  const status = useLive((s) => s.threads[chat.id]?.status ?? chat.status);
  const active = useUi((s) => s.view.kind === "thread" && s.view.id === chat.id);
  const label = title || "Chat sans titre";
  const open = () => useUi.getState().focusThread(chat.id);
  const working = STATUS[status].active;

  if (sub) {
    return (
      <SidebarMenuSubButton isActive={active} onClick={open} title={label}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {working && <StatusDot status={status} className="shrink-0 animate-in fade-in-0 zoom-in-50 duration-200" />}
      </SidebarMenuSubButton>
    );
  }
  return (
    <>
      {/* The status dot sits over the row's right edge: keep the title clear of it. */}
      <SidebarMenuButton isActive={active} onClick={open} tooltip={label} className={working ? "pr-7" : undefined}>
        <AgentLogo agent={chat.agent} />
        <span>{label}</span>
      </SidebarMenuButton>
      {working && (
        <SidebarMenuBadge>
          <StatusDot status={status} className="animate-in fade-in-0 zoom-in-50 duration-200" />
        </SidebarMenuBadge>
      )}
    </>
  );
});

