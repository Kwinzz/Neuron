import { useEffect, useState } from "react";
import { PanelRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/legacy/Button";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { useLive } from "@/stores/live";
import { useUi, type View } from "@/stores/ui";

/** Breadcrumb section + page title for the current view. */
function useViewTitle(view: View): { section: string; title: string } {
  const threadTitle = useLive((s) => (view.kind === "thread" ? s.threads[view.id]?.title : undefined));
  if (view.kind === "thread") return { section: "Threads", title: threadTitle || "Thread" };
  return { section: "Pages", title: "Mission Control" };
}

interface NavbarProps {
  /** Scroll container the navbar floats over (glass effect once scrolled). */
  scrollRoot: HTMLElement | null;
}

/** Vision top bar: breadcrumb + title, search pill, dock toggle. Turns to glass when content scrolls. */
export function Navbar({ scrollRoot }: NavbarProps) {
  const view = useUi((s) => s.view);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!scrollRoot) return;
    const onScroll = () => setScrolled(scrollRoot.scrollTop > 4);
    onScroll();
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", onScroll);
  }, [scrollRoot]);

  const { section, title } = useViewTitle(view);

  return (
    <div className="sticky top-0 z-20 px-4 pb-4 pt-1">
      <header
        className={`flex min-h-[64px] items-center gap-4 rounded-lg border px-4 transition-[background-color,border-color,box-shadow] duration-fast ${
          scrolled
            ? "border-line-strong bg-bg-sunken/70 shadow-[0_7px_23px_rgb(0_0_0/0.25)] backdrop-blur-[42px]"
            : "border-transparent"
        }`}
      >
        <div className="min-w-0 flex-1">
          <nav aria-label="Fil d'Ariane" className="truncate text-xs text-fg-muted">
            {section} <span className="px-1">/</span> <span className="text-fg">{title}</span>
          </nav>
          <h1 className="truncate text-sm font-bold text-fg">{title}</h1>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Button
            className="whitespace-nowrap"
            onClick={() => useUi.getState().setNewThreadOpen(true)}
            title={`Nouveau thread (${MOD_LABEL}+N)`}
          >
            <Plus size={16} />
            Nouveau thread
          </Button>
          <SearchPill />
          <DockToggle />
        </div>
      </header>
    </div>
  );
}

function SearchPill() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      className="flex h-10 w-[240px] items-center gap-2.5 rounded-[15px] border border-line-strong bg-bg-sunken px-3.5 text-sm text-fg-muted transition-colors duration-fast hover:border-hl/60 hover:text-fg"
    >
      <Search size={15} className="text-fg" />
      <span className="flex-1 text-left">Rechercher…</span>
      <Kbd>{MOD_LABEL}</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}

function DockToggle() {
  const dockOpen = useUi((s) => s.dockOpen);
  const toggleDock = useUi((s) => s.toggleDock);
  const attention = useLive((s) => Object.keys(s.attention).length);
  return (
    <button
      type="button"
      onClick={toggleDock}
      aria-pressed={dockOpen}
      title={`${dockOpen ? "Masquer" : "Afficher"} les threads (${MOD_LABEL}+J)`}
      className={`relative flex size-10 items-center justify-center rounded-md transition-colors duration-fast ${
        dockOpen ? "bg-brand text-brand-fg hover:bg-brand-hover" : "bg-surface text-hl hover:bg-surface-hover"
      }`}
    >
      <PanelRight size={17} />
      {attention > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn px-1 text-[10px] font-bold tabular-nums text-bg">
          {attention}
        </span>
      )}
    </button>
  );
}
