import { PanelRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { useUi, type View } from "@/stores/ui";
import { WindowControls } from "./WindowControls";

function useViewTitle(view: View): { section: string; title: string } {
  const chatTitle = useLive((s) => (view.kind === "thread" ? s.threads[view.id]?.title : undefined));
  const projectName = useLive((s) => (view.kind === "thread" ? s.threads[view.id]?.projectName : undefined));
  const draftProject = useNav((s) =>
    view.kind === "draft" && view.projectId ? s.projects.find((p) => p.id === view.projectId)?.name : undefined,
  );
  const pageProject = useNav((s) =>
    view.kind === "project" ? s.projects.find((p) => p.id === view.id)?.name : undefined,
  );
  if (view.kind === "thread") return { section: projectName ?? t("shell.chats"), title: chatTitle || t("shell.chat") };
  if (view.kind === "draft") return { section: draftProject ?? t("shell.chats"), title: t("shell.navNewChat") };
  if (view.kind === "project") return { section: t("shell.projects"), title: pageProject ?? t("shell.project") };
  if (view.kind === "memory") return { section: "Neuron", title: t("shell.navMemory") };
  if (view.kind === "settings") return { section: "Neuron", title: t("shell.navSettings") };
  return { section: "Neuron", title: t("shell.navHome") };
}

/**
 * dashboard-01 site header: sidebar trigger · breadcrumb · actions · window controls.
 * Doubles as the title bar (native one hidden): every bare area carries `data-tauri-drag-region`
 * (drag to move, double-click to maximize); buttons stay clickable.
 */
export function SiteHeader() {
  const view = useUi((s) => s.view);
  const { section, title } = useViewTitle(view);
  const dockOpen = useUi((s) => s.dockOpen);
  return (
    <header
      data-tauri-drag-region
      className="flex h-(--header-height) shrink-0 select-none items-center gap-2 border-b transition-[width,height] ease-linear"
    >
      <div data-tauri-drag-region className="flex w-full min-w-0 items-center gap-1 pl-4 pr-2 lg:gap-2 lg:pl-6">
        <SidebarTrigger className="-ml-1" aria-label={t("shell.scSidebar")} title={t("shell.scSidebar")} />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <nav data-tauri-drag-region aria-label={t("shell.breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span data-tauri-drag-region key={section} className="shrink-0 text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy">{section}</span>
          <span data-tauri-drag-region className="text-muted-foreground">/</span>
          <h1 data-tauri-drag-region key={title} className="truncate font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy">{title}</h1>
        </nav>
        <div data-tauri-drag-region className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="hidden w-56 justify-start gap-2 text-muted-foreground active:scale-[0.97] lg:flex"
            onClick={() => useUi.getState().setPaletteOpen(true)}
          >
            <Search />
            <span className="flex-1 text-left">{t("shell.searchPlaceholder")}</span>
            <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
              {MOD_LABEL} K
            </kbd>
          </Button>
          <Button size="sm" className="active:scale-[0.97]" onClick={() => useUi.getState().startChat(null)} title={t("shell.navNewChatTooltip", { combo: `${MOD_LABEL}+N` })}>
            <Plus />
            {t("shell.navNewChat")}
          </Button>
          <DockToggle />
          {/* The window controls sit in the top-right corner: here, or in the live dock's header when it is open. */}
          {!dockOpen && (
            <>
              <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
              <WindowControls />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function DockToggle() {
  const dockOpen = useUi((s) => s.dockOpen);
  const attention = useLive((s) => Object.keys(s.attention).length);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={dockOpen ? "secondary" : "ghost"}
          size="icon"
          className="relative size-8 active:scale-[0.97]"
          onClick={() => useUi.getState().toggleDock()}
          aria-pressed={dockOpen}
          aria-label={t("shell.liveThreads")}
        >
          <PanelRight />
          {attention > 0 && (
            <span
              key={attention}
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-semibold tabular-nums text-background animate-in zoom-in-50 fade-in-0 duration-200"
            >
              {attention}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("shell.liveThreadsTooltip", { combo: `${MOD_LABEL}+J` })}</TooltipContent>
    </Tooltip>
  );
}
