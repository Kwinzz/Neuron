import { whenIdle } from "@/lib/idle";
import { type CSSProperties, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { cn } from "cn";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { ShortcutsDialog } from "@/components/shortcuts/ShortcutsDialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAgentEventBridge } from "@/hooks/useAgentEventBridge";
import { useHotkey } from "@/hooks/useHotkey";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLayout } from "@/stores/layout";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { useUi } from "@/stores/ui";
import { AppSidebar } from "./AppSidebar";
import { LiveDock } from "./LiveDock";
import { ScrollRootContext } from "./ScrollRoot";
import { SiteHeader } from "./SiteHeader";

// Heavy views (markdown + syntax highlighting, editors) load on demand, then are warmed up when idle so
// opening a chat never waits on the network-free but still non-trivial module evaluation.
const loadChat = () => import("@/views/chat/ChatView");
const loadDraft = () => import("@/views/chat/DraftChat");
const loadProject = () => import("@/views/project/ProjectView");
const loadMemory = () => import("@/views/memory/MemoryView");
const loadHome = () => import("@/views/home/MissionControl");
const loadSettings = () => import("@/views/settings/SettingsView");
const ChatView = lazy(() => loadChat().then((m) => ({ default: m.ChatView })));
const DraftChat = lazy(() => loadDraft().then((m) => ({ default: m.DraftChat })));
const ProjectView = lazy(() => loadProject().then((m) => ({ default: m.ProjectView })));
const MemoryView = lazy(() => loadMemory().then((m) => ({ default: m.MemoryView })));
const MissionControl = lazy(() => loadHome().then((m) => ({ default: m.MissionControl })));
const SettingsView = lazy(() => loadSettings().then((m) => ({ default: m.SettingsView })));

function usePrefetchViews(): void {
  useEffect(() => {
    const warm = () => {
      for (const load of [loadHome, loadChat, loadDraft, loadProject, loadMemory]) void load().catch(() => undefined);
    };
    // The timeout only bounds how long the warm-up may wait (fallback without requestIdleCallback: WebKitGTK).
    return whenIdle(warm, 2000);
  }, []);
}

/** Alt+↑ / Alt+↓: previous / next chat in the recent list. */
function stepChat(delta: 1 | -1): void {
  const chats = useNav.getState().chats;
  if (chats.length === 0) return;
  const view = useUi.getState().view;
  const index = view.kind === "thread" ? chats.findIndex((c) => c.id === view.id) : -1;
  const next = index < 0 ? 0 : Math.min(chats.length - 1, Math.max(0, index + delta));
  const target = chats[next];
  if (target && (index < 0 || next !== index)) useUi.getState().focusThread(target.id);
}

/** Make sure the opened thread's summary is in the live store (title, agent, cwd…). */
function useHydrateOpenThread(): void {
  const threadId = useUi((s) => (s.view.kind === "thread" ? s.view.id : null));
  useEffect(() => {
    if (!threadId) return;
    useLive.getState().markSeen(threadId);
    if (useLive.getState().threads[threadId]) return;
    ipc
      .getThread(threadId)
      .then((summary) => useLive.getState().hydrate([summary]))
      .catch(() => undefined);
  }, [threadId]);
}


/** shadcn "dashboard-01" frame: inset sidebar · header + scrolling view · live dock, plus overlays. */
export function AppShell() {
  const view = useUi((s) => s.view);
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const providerStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${sidebarWidth}px`,
        "--header-height": "calc(var(--spacing) * 12)",
      }) as CSSProperties,
    [sidebarWidth],
  );
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  useAgentEventBridge();
  useHydrateOpenThread();
  usePrefetchViews();

  useEffect(() => {
    void useDashboard.getState().load();
  }, []);

  useHotkey("mod+k", () => useUi.getState().togglePalette());
  useHotkey("mod+j", () => useUi.getState().toggleDock());
  useHotkey("mod+n", () => useUi.getState().startChat(null));
  useHotkey("mod+shift+h", () => useUi.getState().navigate({ kind: "home" }));
  useHotkey("mod+shift+m", () => useUi.getState().navigate({ kind: "memory" }));
  useHotkey("mod+,", () => useUi.getState().openSettings());
  useHotkey("mod+/", () => useUi.getState().setShortcutsOpen(!useUi.getState().shortcutsOpen));
  useHotkey("alt+arrowup", () => stepChat(-1), { allowInInputs: true });
  useHotkey("alt+arrowdown", () => stepChat(1), { allowInInputs: true });

  const viewKey =
    view.kind === "thread"
      ? `thread-${view.id}`
      : view.kind === "draft"
        ? `draft-${view.projectId ?? ""}`
        : view.kind === "project"
          ? `project-${view.id}`
          : view.kind;

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider style={providerStyle} className="h-svh min-h-0 overflow-hidden">
        <AppSidebar variant="inset" collapsible="icon" />
        <SidebarInset className="min-w-0 overflow-hidden md:peer-data-[variant=inset]:mr-0">
          <SiteHeader />
          <ScrollRootContext.Provider value={scrollRoot}>
            <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div
                key={viewKey}
                className={cn(
                  "flex min-h-full min-w-0 flex-col *:flex-1",
                  view.kind === "thread" ? "view-fade" : "view-enter",
                )}
              >
                <Suspense fallback={null}>
                  {view.kind === "home" && <MissionControl />}
                  {view.kind === "draft" && <DraftChat key={`draft-${view.projectId ?? ""}`} projectId={view.projectId} />}
                  {view.kind === "thread" && <ChatView key={view.id} threadId={view.id} />}
                  {view.kind === "project" && <ProjectView key={view.id} projectId={view.id} tab={view.tab} />}
                  {view.kind === "memory" && <MemoryView />}
                  {view.kind === "settings" && <SettingsView section={view.section} />}
                </Suspense>
              </div>
            </div>
          </ScrollRootContext.Provider>
        </SidebarInset>
        <LiveDock />
      </SidebarProvider>
      <CommandPalette />
      <ShortcutsDialog />
      <Toaster theme="dark" position="bottom-right" richColors={false} />
    </TooltipProvider>
  );
}
