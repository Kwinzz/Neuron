import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { useAgentEventBridge } from "@/hooks/useAgentEventBridge";
import { useHotkey } from "@/hooks/useHotkey";
import { useDashboard } from "@/stores/dashboard";
import { useUi } from "@/stores/ui";
import { MissionControl } from "@/views/home/MissionControl";
import { LiveDock } from "./LiveDock";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./Toaster";

/** Persistent app frame: floating sidebar · navbar + main view · floating live dock, plus overlays. */
export function AppShell() {
  const view = useUi((s) => s.view);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  useAgentEventBridge();

  useEffect(() => {
    void useDashboard.getState().load();
  }, []);

  useHotkey("mod+k", () => useUi.getState().togglePalette());
  useHotkey("mod+j", () => useUi.getState().toggleDock());

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <Sidebar />
      <main ref={setScrollRoot} className="-my-4 min-w-0 flex-1 overflow-y-auto py-4">
        <Navbar scrollRoot={scrollRoot} />
        {view.kind === "home" && <MissionControl />}
      </main>
      <LiveDock />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
