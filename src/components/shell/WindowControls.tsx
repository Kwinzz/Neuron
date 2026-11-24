import { cn } from "cn";
import { Copy, Minus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { t } from "@/i18n";
import { appWindow } from "@/lib/ipc";

/** Minimize / maximize-restore / close, replacing the native title bar (`decorations: false`). */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const sync = () => {
      appWindow
        .isMaximized()
        .then((v) => {
          if (!disposed) setMaximized(v);
        })
        .catch(() => undefined);
    };
    sync();
    appWindow
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <ControlButton label={t("shell.winMinimize")} onClick={() => void appWindow.minimize()}>
        <Minus className="size-4" />
      </ControlButton>
      <ControlButton
        label={maximized ? t("shell.winRestore") : t("shell.winMaximize")}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {maximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
      </ControlButton>
      <ControlButton label={t("common.close")} danger onClick={() => void appWindow.close()}>
        <X className="size-4" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
