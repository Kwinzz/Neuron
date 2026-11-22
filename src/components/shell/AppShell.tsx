import { type CSSProperties, useEffect, useState } from "react";
import { cn } from "cn";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAgentEventBridge } from "@/hooks/useAgentEventBridge";
import { useHotkey } from "@/hooks/useHotkey";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { ChatView } from "@/views/chat/ChatView";
import { DraftChat } from "@/views/chat/DraftChat";
import { MissionControl } from "@/views/home/MissionControl";
import { ProjectView } from "@/views/project/ProjectView";
import { AppSidebar } from "./AppSidebar";
import { LiveDock } from "./LiveDock";
import { ScrollRootContext } from "./ScrollRoot";
import { SiteHeader } from "./SiteHeader";

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

const PROVIDER_STYLE = {
  "--sidebar-width": "calc(var(--spacing) * 64)",
  "--header-height": "calc(var(--spacing) * 12)",
} as CSSProperties;

/** shadcn "dashboard-01" frame: inset sidebar · header + scrolling view · live dock, plus overlays. */
export function AppShell() {
  const view = useUi((s) => s.view);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  useAgentEventBridge();
  useHydrateOpenThread();

  useEffect(() => {
    void useDashboard.getState().load();
  }, []);

  useHotkey("mod+k", () => useUi.getState().togglePalette());
  useHotkey("mod+j", () => useUi.getState().toggleDock());
  useHotkey("mod+n", () => useUi.getState().startChat(null));

  const viewKey =
    view.kind === "thread"
      ? `thread-${view.id}`
      : view.kind === "draft"
        ? `draft-${view.projectId ?? ""}`
        : view.kind === "project"
          ? `project-${view.id}`
          : "home";

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider style={PROVIDER_STYLE} className="h-svh min-h-0 overflow-hidden">
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
                {view.kind === "home" && <MissionControl />}
                {view.kind === "draft" && <DraftChat key={`draft-${view.projectId ?? ""}`} projectId={view.projectId} />}
                {view.kind === "thread" && <ChatView key={view.id} threadId={view.id} />}
                {view.kind === "project" && <ProjectView key={view.id} projectId={view.id} tab={view.tab} />}
              </div>
            </div>
          </ScrollRootContext.Provider>
        </SidebarInset>
        <LiveDock />
      </SidebarProvider>
      <CommandPalette />
      <Toaster theme="dark" position="bottom-right" richColors={false} />
    </TooltipProvider>
  );
}
