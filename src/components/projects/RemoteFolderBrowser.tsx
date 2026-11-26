import { useEffect, useState } from "react";
import { ArrowUp, Folder, Home, Loader2 } from "lucide-react";
import type { DirListing } from "@/bindings/DirListing";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";

interface RemoteFolderBrowserProps {
  /** Device whose folders are browsed (null = this PC). */
  device: string | null;
  /** Folder shown (= the folder chosen); null = home folder. */
  path: string | null;
  onPathChange: (path: string) => void;
}

/**
 * Folder explorer for a device without a native picker (a paired device): the folder shown is the one chosen.
 * Click a sub-folder to go into it; up / home / drives to move around.
 */
export function RemoteFolderBrowser({ device, path, onPathChange }: RemoteFolderBrowserProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .listDirectory(path, device)
      .then((next) => {
        if (cancelled) return;
        setListing(next);
        setError(null);
        // The home folder was asked for: report where we are.
        if (path === null) onPathChange(next.path);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(ipcErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onPathChange is a parent callback; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, path]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background/60 p-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && onPathChange(listing.parent)}
          aria-label={t("shell.browseUp")}
          title={t("shell.browseUp")}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={!listing}
          onClick={() => listing && onPathChange(listing.home)}
          aria-label={t("shell.browseHome")}
          title={t("shell.browseHome")}
        >
          <Home className="size-3.5" />
        </Button>
        {listing && listing.roots.length > 1 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {listing.roots.map((root) => (
              <Button
                key={root}
                type="button"
                variant={listing.path.toLowerCase().startsWith(root.toLowerCase()) ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-1.5 font-mono text-[11px]"
                onClick={() => onPathChange(root)}
              >
                {root.replace(/\\$/, "")}
              </Button>
            ))}
          </div>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={listing?.path ?? ""} dir="rtl">
          {/* rtl + bdi: a long path keeps its end (the current folder) visible. */}
          <bdi>{listing?.path ?? ""}</bdi>
        </span>
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      <div className="h-44 min-w-0 overflow-y-auto" role="listbox" aria-label={t("shell.browseLabel")}>
        {error ? (
          <p className="px-2 py-3 text-xs text-destructive">{error}</p>
        ) : listing && listing.entries.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{t("shell.browseEmpty")}</p>
        ) : (
          listing?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onPathChange(entry.path)}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{entry.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
