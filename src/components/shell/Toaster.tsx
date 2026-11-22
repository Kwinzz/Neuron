import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { IconBox } from "@/components/ui/IconBox";
import { type ToastTone, useToasts } from "@/stores/toast";

const ICON: Record<ToastTone, typeof Info> = { info: Info, ok: CheckCircle2, warn: AlertTriangle, danger: XCircle };
const TONE: Record<ToastTone, "cyan" | "ok" | "warn" | "danger"> = { info: "cyan", ok: "ok", warn: "warn", danger: "danger" };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[380px] -translate-x-1/2 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            className="glass-overlay toast-in pointer-events-auto flex items-center gap-3 px-3.5 py-3 shadow-xl shadow-black/50"
          >
            <IconBox tone={TONE[t.tone]} size={36}>
              <Icon size={17} />
            </IconBox>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                t.onClick?.();
                dismiss(t.id);
              }}
            >
              <p className="text-sm font-bold text-fg">{t.title}</p>
              {t.description && <p className="truncate text-xs text-fg-muted">{t.description}</p>}
            </button>
            <button
              type="button"
              aria-label="Fermer"
              className="rounded-sm p-1 text-fg-muted transition-colors duration-fast hover:text-fg"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
