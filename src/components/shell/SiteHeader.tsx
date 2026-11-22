import { PanelRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { useUi, type View } from "@/stores/ui";

function useViewTitle(view: View): { section: string; title: string } {
  const chatTitle = useLive((s) => (view.kind === "thread" ? s.threads[view.id]?.title : undefined));
  const projectName = useLive((s) => (view.kind === "thread" ? s.threads[view.id]?.projectName : undefined));
  const draftProject = useNav((s) =>
    view.kind === "draft" && view.projectId ? s.projects.find((p) => p.id === view.projectId)?.name : undefined,
  );
  const pageProject = useNav((s) =>
    view.kind === "project" ? s.projects.find((p) => p.id === view.id)?.name : undefined,
  );
  if (view.kind === "thread") return { section: projectName ?? "Chats", title: chatTitle || "Chat" };
  if (view.kind === "draft") return { section: draftProject ?? "Chats", title: "Nouveau chat" };
  if (view.kind === "project") return { section: "Projets", title: pageProject ?? "Projet" };
  if (view.kind === "memory") return { section: "Neuron", title: "Mémoire" };
  return { section: "Neuron", title: "Accueil" };
}

/** dashboard-01 site header: sidebar trigger · breadcrumb · actions. */
export function SiteHeader() {
  const view = useUi((s) => s.view);
  const { section, title } = useViewTitle(view);
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-sm">
          <span key={section} className="shrink-0 text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy">{section}</span>
          <span className="text-muted-foreground">/</span>
          <h1 key={title} className="truncate font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy">{title}</h1>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="hidden w-56 justify-start gap-2 text-muted-foreground active:scale-[0.97] lg:flex"
            onClick={() => useUi.getState().setPaletteOpen(true)}
          >
            <Search />
            <span className="flex-1 text-left">Rechercher…</span>
            <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
              {MOD_LABEL} K
            </kbd>
          </Button>
          <Button size="sm" className="active:scale-[0.97]" onClick={() => useUi.getState().startChat(null)} title={`Nouveau chat (${MOD_LABEL}+N)`}>
            <Plus />
            Nouveau chat
          </Button>
          <DockToggle />
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
          aria-label="Threads live"
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
      <TooltipContent>Threads live ({MOD_LABEL}+J)</TooltipContent>
    </Tooltip>
  );
}
