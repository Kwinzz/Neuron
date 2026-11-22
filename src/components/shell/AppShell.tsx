import { useEffect } from "react";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { useAgentEventBridge } from "@/hooks/useAgentEventBridge";
import { useHotkey } from "@/hooks/useHotkey";
import { useDashboard } from "@/stores/dashboard";
import { useUi } from "@/stores/ui";
import { MissionControl } from "@/views/home/MissionControl";
import { LiveDock } from "./LiveDock";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./Toaster";

/** Persistent app frame: sidebar · main view · live dock, plus global overlays. */
export function AppShell() {
  const view = useUi((s) => s.view);
  useAgentEventBridge();

  useEffect(() => {
    void useDashboard.getState().load();
  }, []);

  useHotkey("mod+k", () => useUi.getState().togglePalette());
  useHotkey("mod+j", () => useUi.getState().toggleDock());

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{view.kind === "home" && <MissionControl />}</main>
      <LiveDock />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
