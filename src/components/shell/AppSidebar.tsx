import { type ComponentProps, type KeyboardEvent, type ReactNode, memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
  Brain,
  Settings,
  ChevronRight,
  CirclePlus,
  Download,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
} from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { RemoteHost } from "@/bindings/RemoteHost";
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
  SidebarFooter,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useHotkey } from "@/hooks/useHotkey";
import { renameProject } from "@/lib/projectActions";
import { STATUS } from "@/lib/status";
import { useDevices } from "@/stores/devices";
import { useLive } from "@/stores/live";
import { useNewProject } from "@/stores/newProject";
import { type SidebarSection, isSectionCollapsed, partitionSidebar, useNav } from "@/stores/nav";
import { useProjectRemoval } from "@/stores/projectRemoval";
import { useUi } from "@/stores/ui";
import { useUpdate } from "@/stores/update";
import neuronMark from "@/assets/neuron-mark.png";
import { t } from "@/i18n";
import { ChatRow } from "./ChatRow";
import { SidebarFilter } from "./SidebarFilter";
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
        <SidebarSections />
      </SidebarContent>

      <UpdateBadge />

      <SidebarResizer />
    </Sidebar>
  );
}

/** « Mise à jour disponible » at the bottom of the sidebar → Paramètres → Mises à jour. */
function UpdateBadge() {
  const latest = useUpdate((s) => (s.info?.available ? s.info.latest : null));
  if (latest === null) return null;
  const label = t("shell.updateAvailable");
  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t("settings.updatesAvailableTitle", { version: latest })}
            onClick={() => useUi.getState().openSettings("updates")}
            className="border text-foreground"
          >
            <Download />
            <span>{label}</span>
          </SidebarMenuButton>
          <SidebarMenuBadge className="font-mono text-muted-foreground">{latest}</SidebarMenuBadge>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
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
              tooltip={t("shell.navNewChatTooltip", { combo: `${MOD_LABEL}+N` })}
              isActive={isDraft}
              onClick={() => useUi.getState().startChat(null)}
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            >
              <CirclePlus />
              <span>{t("shell.navNewChat")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("shell.navHome")} isActive={isHome} onClick={() => useUi.getState().navigate({ kind: "home" })}>
              <Home />
              <span>{t("shell.navHome")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("shell.navMemory")} isActive={isMemory} onClick={() => useUi.getState().navigate({ kind: "memory" })}>
              <Brain />
              <span>{t("shell.navMemory")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("shell.navSettingsTooltip", { combo: `${MOD_LABEL}+,` })} isActive={isSettings} onClick={() => useUi.getState().openSettings()}>
              <Settings />
              <span>{t("shell.navSettings")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("shell.navSearchTooltip", { combo: `${MOD_LABEL}+K` })} onClick={() => useUi.getState().setPaletteOpen(true)}>
              <Search />
              <span>{t("common.search")}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge className="text-muted-foreground">{MOD_LABEL}+K</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const EMPTY: ThreadSummary[] = [];
const EMPTY_PROJECTS: ProjectSummary[] = [];
const EMPTY_HOSTS: readonly RemoteHost[] = [];

/** Projects and chats split between this device, each paired host and archived chats, with fuzzy title filtering. */
function SidebarSections() {
  const projects = useNav((s) => s.projects);
  const chats = useNav((s) => s.chats);
  const hosts = useDevices((s) => s.devices?.hosts) ?? EMPTY_HOSTS;
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile, setOpenMobile } = useSidebar();

  useHotkey("mod+shift+f", () => {
    if (isMobile) {
      setOpenMobile(true);
    } else if (!sidebarOpen) {
      setSidebarOpen(true);
    }
    window.requestAnimationFrame(() => {
      filterRef.current?.focus();
      filterRef.current?.select();
    });
  });

  const trimmedFilter = filter.trim();
  const filtering = trimmedFilter.length > 0;
  const untitledLabel = t("common.untitledChat");

  const partitioned = useMemo(
    () =>
      partitionSidebar(
        projects,
        chats,
        hosts,
        filtering ? { query: trimmedFilter, untitledLabel } : undefined,
      ),
    [projects, chats, hosts, filtering, trimmedFilter, untitledLabel],
  );

  return (
    <>
      <SidebarFilter value={filter} onChange={setFilter} inputRef={filterRef} />
      {filtering && !partitioned.hasAnyMatch ? (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-sidebar-border px-3 py-5 text-center">
            <SearchX className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground wrap-anywhere">
              {t("shell.filterNoMatch", { query: filter.trim() })}
            </p>
            <button
              type="button"
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
              className="mt-0.5 rounded-xs text-xs font-medium text-sidebar-foreground underline-offset-4 outline-hidden transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              {t("shell.filterClear")}
            </button>
          </div>
        </SidebarGroup>
      ) : (
        <>
          {(!filtering || partitioned.visibleLocalProjects.length > 0) && (
            <ProjectsNav
              projects={partitioned.visibleLocalProjects}
              byProject={partitioned.chatsByProject}
              filtering={filtering}
            />
          )}
          <LooseChatsNav chats={partitioned.localLooseChats} filtering={filtering} />
          <RemoteDevicesNav
            hosts={partitioned.visibleHosts}
            projectsByDevice={partitioned.visibleProjectsByDevice}
            looseChatsByDevice={partitioned.looseChatsByDevice}
            chatsByDevice={partitioned.chatsByDevice}
            byProject={partitioned.chatsByProject}
            filtering={filtering}
          />
          <ArchivedChatsNav chats={partitioned.archivedChats} filtering={filtering} />
        </>
      )}
    </>
  );
}

/** Chats of `chats` running right now. */
function useActiveCount(chats: readonly ThreadSummary[]): number {
  return useLive((s) => chats.filter((c) => STATUS[s.threads[c.id]?.status ?? c.status].active).length);
}

/** A sidebar group whose label folds it away (state kept across launches); `action` stays visible when folded. */
function SectionGroup({
  section,
  label,
  activeCount,
  count,
  forceOpen = false,
  action,
  className,
  children,
}: {
  section: SidebarSection;
  label: string;
  activeCount: number;
  count?: number;
  forceOpen?: boolean;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const storedCollapsed = useNav((s) => isSectionCollapsed(s.collapsedSections, section));
  const collapsed = forceOpen ? false : storedCollapsed;
  return (
    <Collapsible
      asChild
      open={!collapsed}
      onOpenChange={() => {
        if (!forceOpen) useNav.getState().toggleSection(section);
      }}
    >
      <SidebarGroup className={className}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            className={cn(
              "w-full gap-1.5 text-left transition-colors duration-150 hover:text-sidebar-foreground",
              action && "pr-8",
            )}
            title={collapsed ? t("shell.sectionShow", { name: label }) : t("shell.sectionHide", { name: label })}
          >
            <ChevronRight
              className={cn("size-3! transition-transform duration-150", !collapsed && "rotate-90")}
              aria-hidden
            />
            <span>{label}</span>
            {collapsed && activeCount > 0 ? (
              <span className="ml-auto flex items-center gap-1 text-live tabular-nums animate-in fade-in-0 zoom-in-75 duration-200">
                <span className="size-1.5 animate-pulse rounded-full bg-live" />
                {activeCount}
              </span>
            ) : (
              count !== undefined && (
                <span className="ml-auto text-[11px] text-muted-foreground/70 tabular-nums">{count}</span>
              )
            )}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          {children}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function ProjectsNav({
  projects,
  byProject,
  filtering = false,
}: {
  projects: ProjectSummary[];
  byProject: Map<string, ThreadSummary[]>;
  filtering?: boolean;
}) {
  const projectChats = useMemo(() => projects.flatMap((p) => byProject.get(p.id) ?? EMPTY), [projects, byProject]);
  const activeCount = useActiveCount(projectChats);
  return (
    <SectionGroup
      section="projects"
      label={t("shell.projects")}
      activeCount={activeCount}
      forceOpen={filtering}
      action={
        <SidebarGroupAction title={t("shell.addProjectTitle")} onClick={() => useNewProject.getState().show(null)}>
          <FolderPlus />
          <span className="sr-only">{t("shell.addProject")}</span>
        </SidebarGroupAction>
      }
    >
      <SidebarMenu>
        {!filtering && projects.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => useNewProject.getState().show(null)} className="text-muted-foreground">
              <FolderPlus />
              <span>{t("shell.addFolder")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {projects.map((p) => (
          <ProjectFolder key={p.id} project={p} chats={byProject.get(p.id) ?? EMPTY} filtering={filtering} />
        ))}
      </SidebarMenu>
    </SectionGroup>
  );
}

const ProjectFolder = memo(function ProjectFolder({
  project,
  chats,
  nested = false,
  filtering = false,
}: {
  project: ProjectSummary;
  chats: ThreadSummary[];
  nested?: boolean;
  filtering?: boolean;
}) {
  const storedOpen = useNav((s) => s.openProjects[project.id] ?? false);
  const open = filtering || storedOpen;
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const settledRef = useRef(false);
  const skipCloseFocusRef = useRef(false);
  const restoreButtonFocusRef = useRef(false);
  const draftHere = useUi((s) => s.view.kind === "draft" && s.view.projectId === project.id);
  const pageHere = useUi((s) => s.view.kind === "project" && s.view.id === project.id);
  const activeCount = useLive((s) => chats.filter((c) => STATUS[s.threads[c.id]?.status ?? c.status].active).length);
  const visible = filtering || showAll ? chats : chats.slice(0, PAGE);

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    } else if (restoreButtonFocusRef.current) {
      restoreButtonFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const startEdit = (fromMenu = false) => {
    if (fromMenu) skipCloseFocusRef.current = true;
    settledRef.current = false;
    restoreButtonFocusRef.current = false;
    setDraft(project.name);
    setEditing(true);
  };

  const commit = async (fromKeyboard = false) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (fromKeyboard) restoreButtonFocusRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === project.name) return;
    await renameProject(project.id, trimmed);
  };

  const cancelEdit = (fromKeyboard = false) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (fromKeyboard) restoreButtonFocusRef.current = true;
    setEditing(false);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit(true);
    }
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      startEdit(false);
    }
  };

  const onMenuCloseAutoFocus = (e: Event) => {
    if (!skipCloseFocusRef.current) return;
    e.preventDefault();
    skipCloseFocusRef.current = false;
    const input = inputRef.current;
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  };

  return (
    <Collapsible
      asChild
      open={open}
      onOpenChange={(o) => {
        if (!filtering && !editing) useNav.getState().setProjectOpen(project.id, o);
      }}
    >
      <SidebarMenuItem>
        {editing ? (
          <div
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-md bg-sidebar-accent px-2 group-data-[collapsible=icon]:hidden",
              nested ? "h-7" : "h-8",
            )}
          >
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")}
              aria-hidden
            />
            {open ? <FolderOpen className="size-4 shrink-0" aria-hidden /> : <Folder className="size-4 shrink-0" aria-hidden />}
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              onBlur={() => void commit(false)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t("project.projectName")}
              className="h-6 min-w-0 flex-1 rounded-sm bg-background px-1.5 text-sm text-sidebar-foreground ring-1 ring-sidebar-ring outline-none"
            />
          </div>
        ) : (
          <>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                ref={buttonRef}
                tooltip={project.path}
                onKeyDown={onButtonKeyDown}
                className={nested ? "h-7" : undefined}
              >
                <ChevronRight
                  className={`size-3.5! text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
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

            <DropdownMenu
              onOpenChange={(menuOpen) => {
                if (menuOpen) skipCloseFocusRef.current = false;
              }}
            >
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover className={nested ? "top-1" : undefined}>
                  <MoreHorizontal />
                  <span className="sr-only">{t("shell.projectActions")}</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-52" onCloseAutoFocus={onMenuCloseAutoFocus}>
                <DropdownMenuItem onSelect={() => useUi.getState().startChat(project.id)}>
                  <Plus />
                  {t("shell.newChatHere")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => useUi.getState().openProject(project.id, "context")}>
                  <FileText />
                  {t("shell.projectContext")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    useUi.getState().selectProject(project.id);
                    useUi.getState().setDockOpen(true);
                  }}
                >
                  <MessageSquare />
                  {t("shell.filterDock")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => startEdit(true)}>
                  <Pencil />
                  {t("project.rename")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => useProjectRemoval.getState().request(project.id)}
                >
                  <Trash2 />
                  {t("shell.removeProject")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub className={nested ? "mr-0 pr-0" : undefined}>
            {!filtering && (
              <>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    isActive={draftHere}
                    onClick={() => useUi.getState().startChat(project.id)}
                    className="text-muted-foreground"
                  >
                    <Plus />
                    <span>{t("shell.navNewChat")}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    isActive={pageHere}
                    onClick={() => useUi.getState().openProject(project.id, "context")}
                    className="text-muted-foreground"
                  >
                    <FileText />
                    <span>{t("shell.contextAndProject")}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </>
            )}
            {visible.map((c, i) => (
              <ChatRow
                key={c.id}
                chat={c}
                sub
                className={filtering ? undefined : "animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-150"}
                style={filtering ? undefined : { animationDelay: `${Math.min(i, 10) * 25}ms` }}
              />
            ))}
            {!filtering && chats.length > PAGE && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
                  <span>{showAll ? t("shell.showLess") : t("shell.showMore", { n: chats.length - PAGE })}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
});

function LooseChatsNav({ chats, filtering = false }: { chats: ThreadSummary[]; filtering?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const activeCount = useActiveCount(chats);
  if (chats.length === 0) return null;
  const visible = filtering || showAll ? chats : chats.slice(0, PAGE);
  return (
    <SectionGroup
      section="chats"
      label={t("shell.chats")}
      activeCount={activeCount}
      forceOpen={filtering}
      className="group-data-[collapsible=icon]:hidden"
    >
      <SidebarMenu>
        {visible.map((c, i) => (
          <ChatRow
            key={c.id}
            chat={c}
            className={filtering ? undefined : "animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-150"}
            style={filtering ? undefined : { animationDelay: `${Math.min(i, 10) * 25}ms` }}
          />
        ))}
        {!filtering && chats.length > PAGE && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
              <span>{showAll ? t("shell.showLess") : t("shell.showMore", { n: chats.length - PAGE })}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SectionGroup>
  );
}

function RemoteDevicesNav({
  hosts,
  projectsByDevice,
  looseChatsByDevice,
  chatsByDevice,
  byProject,
  filtering = false,
}: {
  hosts: readonly RemoteHost[];
  projectsByDevice: Map<string, ProjectSummary[]>;
  looseChatsByDevice: Map<string, ThreadSummary[]>;
  chatsByDevice: Map<string, ThreadSummary[]>;
  byProject: Map<string, ThreadSummary[]>;
  filtering?: boolean;
}) {
  const deviceChats = useMemo(() => [...chatsByDevice.values()].flat(), [chatsByDevice]);
  const activeCount = useActiveCount(deviceChats);
  if (hosts.length === 0) return null;
  return (
    <SectionGroup section="devices" label={t("shell.devices")} activeCount={activeCount} forceOpen={filtering}>
      <SidebarMenu>
        {hosts.map((host) => (
          <DeviceFolder
            key={host.nodeId}
            host={host}
            projects={projectsByDevice.get(host.nodeId) ?? EMPTY_PROJECTS}
            looseChats={looseChatsByDevice.get(host.nodeId) ?? EMPTY}
            allChats={chatsByDevice.get(host.nodeId) ?? EMPTY}
            byProject={byProject}
            filtering={filtering}
          />
        ))}
      </SidebarMenu>
    </SectionGroup>
  );
}

const DeviceFolder = memo(function DeviceFolder({
  host,
  projects,
  looseChats,
  allChats,
  byProject,
  filtering = false,
}: {
  host: RemoteHost;
  projects: ProjectSummary[];
  looseChats: ThreadSummary[];
  allChats: ThreadSummary[];
  byProject: Map<string, ThreadSummary[]>;
  filtering?: boolean;
}) {
  const storedOpen = useNav((s) => s.openDevices[host.nodeId]);
  const open = filtering || (storedOpen ?? host.connected);
  const [showAll, setShowAll] = useState(false);
  const activeCount = useLive((s) => allChats.filter((c) => STATUS[s.threads[c.id]?.status ?? c.status].active).length);
  const visibleLoose = filtering || showAll ? looseChats : looseChats.slice(0, PAGE);
  const statusLabel = host.connected ? t("shell.deviceOnline") : t("shell.deviceOffline");

  return (
    <Collapsible
      asChild
      open={open}
      onOpenChange={(o) => {
        if (!filtering) useNav.getState().setDeviceOpen(host.nodeId, o);
      }}
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={`${host.name} · ${statusLabel}`}
            className={!host.connected ? "text-muted-foreground" : undefined}
          >
            <ChevronRight
              className={`size-3.5! text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
            <Monitor />
            <span>{host.name}</span>
            {activeCount > 0 ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-live tabular-nums animate-in fade-in-0 zoom-in-75 animation-duration-200">
                <span className="size-1.5 animate-pulse rounded-full bg-live" />
                {activeCount}
              </span>
            ) : (
              <span
                aria-label={statusLabel}
                title={statusLabel}
                className={`ml-auto size-1.5 shrink-0 rounded-full ${host.connected ? "bg-ok" : "bg-muted-foreground/40"}`}
              />
            )}
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub className="mr-0 pr-0">
            {!filtering && host.connected && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  onClick={() => useNewProject.getState().show(host.nodeId)}
                  className="text-muted-foreground"
                >
                  <FolderPlus />
                  <span>{t("shell.newProjectOnDevice")}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {projects.map((p) => (
              <ProjectFolder key={p.id} project={p} chats={byProject.get(p.id) ?? EMPTY} nested filtering={filtering} />
            ))}
            {projects.length > 0 && looseChats.length > 0 && (
              <li className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground select-none">
                {t("shell.chats")}
              </li>
            )}
            {visibleLoose.map((c, i) => (
              <ChatRow
                key={c.id}
                chat={c}
                compact
                className={filtering ? undefined : "animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-150"}
                style={filtering ? undefined : { animationDelay: `${Math.min(i, 10) * 25}ms` }}
              />
            ))}
            {!filtering && looseChats.length > PAGE && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
                  <span>{showAll ? t("shell.showLess") : t("shell.showMore", { n: looseChats.length - PAGE })}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {!filtering && projects.length === 0 && looseChats.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                {host.connected ? t("shell.deviceEmpty") : t("shell.deviceOffline")}
              </li>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
});

/** Collapsible « Archivés » section at the bottom of the sidebar (collapsed by default, persisted in nav store). */
function ArchivedChatsNav({ chats, filtering = false }: { chats: ThreadSummary[]; filtering?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const activeCount = useActiveCount(chats);
  if (chats.length === 0) return null;
  const visible = filtering || showAll ? chats : chats.slice(0, PAGE);
  return (
    <SectionGroup
      section="archived"
      label={t("shell.archived")}
      activeCount={activeCount}
      count={chats.length}
      forceOpen={filtering}
      className="group-data-[collapsible=icon]:hidden"
    >
      <SidebarMenu>
        {visible.map((c, i) => (
          <ChatRow
            key={c.id}
            chat={c}
            muted
            className={filtering ? undefined : "animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-150"}
            style={filtering ? undefined : { animationDelay: `${Math.min(i, 10) * 25}ms` }}
          />
        ))}
        {!filtering && chats.length > PAGE && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground">
              <span>{showAll ? t("shell.showLess") : t("shell.showMore", { n: chats.length - PAGE })}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SectionGroup>
  );
}

