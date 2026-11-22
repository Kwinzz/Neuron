import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { NewThreadDialog } from "@/components/threads/NewThreadDialog";
import { useAgentEventBridge } from "@/hooks/useAgentEventBridge";
import { useHotkey } from "@/hooks/useHotkey";
import { ipc } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { ChatView } from "@/views/chat/ChatView";
import { MissionControl } from "@/views/home/MissionControl";
import { LiveDock } from "./LiveDock";
import { Navbar } from "./Navbar";
import { ScrollRootContext } from "./ScrollRoot";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./Toaster";

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

/** Persistent app frame: floating sidebar · navbar + main view · floating live dock, plus overlays. */
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
  useHotkey("mod+n", () => useUi.getState().setNewThreadOpen(true));

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <Sidebar />
      <ScrollRootContext.Provider value={scrollRoot}>
        <main ref={setScrollRoot} className="-my-4 min-w-0 flex-1 overflow-y-auto py-4">
          <Navbar scrollRoot={scrollRoot} />
          {view.kind === "home" && <MissionControl />}
          {view.kind === "thread" && <ChatView key={view.id} threadId={view.id} />}
        </main>
      </ScrollRootContext.Provider>
      <LiveDock />
      <CommandPalette />
      <NewThreadDialog />
      <Toaster />
    </div>
  );
}
