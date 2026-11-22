import { type ComponentProps, useEffect, useState } from "react";
import { BrainCircuit, CirclePlus, Database, FolderGit2, LayoutDashboard, MessageSquare, Search } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { AppInfo } from "@/bindings/AppInfo";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { StatusDot } from "@/components/ui/StatusDot";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const RECENT_LIMIT = 8;

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => useUi.getState().navigate({ kind: "home" })} tooltip="Neuron">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BrainCircuit className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Neuron</span>
                <span className="truncate text-xs text-muted-foreground">Poste de pilotage IA</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <MainNav />
        <ProjectsNav />
        <RecentThreadsNav />
      </SidebarContent>

      <SidebarFooter>
        <StatusFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function MainNav() {
  const isHome = useUi((s) => s.view.kind === "home");
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip={`Nouveau thread (${MOD_LABEL}+N)`}
              onClick={() => useUi.getState().setNewThreadOpen(true)}
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
            >
              <CirclePlus />
              <span>Nouveau thread</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Mission Control"
              isActive={isHome}
              onClick={() => useUi.getState().navigate({ kind: "home" })}
            >
              <LayoutDashboard />
              <span>Mission Control</span>
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

function ProjectsNav() {
  const projects = useDashboard((s) => s.snapshot?.projects);
  const selected = useUi((s) => s.selectedProjectId);
  if (!projects || projects.length === 0) return null;
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projets</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((p) => {
          const active = selected === p.id;
          return (
            <SidebarMenuItem key={p.id}>
              <SidebarMenuButton
                isActive={active}
                title={`${p.path}\nFiltrer le dock sur ce projet`}
                onClick={() => {
                  useUi.getState().selectProject(active ? null : p.id);
                  if (!active) useUi.getState().setDockOpen(true);
                }}
              >
                <FolderGit2 />
                <span>{p.name}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className={p.activeCount > 0 ? "text-live" : "text-muted-foreground"}>
                {p.activeCount > 0 ? `${p.activeCount} actif${p.activeCount > 1 ? "s" : ""}` : p.threadCount}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function RecentThreadsNav() {
  const openId = useUi((s) => (s.view.kind === "thread" ? s.view.id : null));
  const threads = useLive(
    useShallow((s) =>
      Object.values(s.threads)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RECENT_LIMIT)
        .map((t) => ({ id: t.id, title: t.title, status: t.status })),
    ),
  );
  if (threads.length === 0) return null;
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Threads</SidebarGroupLabel>
      <SidebarMenu>
        {threads.map((t) => (
          <SidebarMenuItem key={t.id}>
            <SidebarMenuButton isActive={openId === t.id} onClick={() => useUi.getState().focusThread(t.id)}>
              <MessageSquare />
              <span>{t.title || "Thread sans titre"}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>
              <StatusDot status={t.status} />
            </SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function StatusFooter() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="sm" tooltip={info?.dbPath ?? "SQLite"} className="text-muted-foreground">
          <Database />
          <span>SQLite v{info?.schemaVersion ?? "–"}</span>
          <span className="ml-auto tabular-nums">v{info?.version ?? "–"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
