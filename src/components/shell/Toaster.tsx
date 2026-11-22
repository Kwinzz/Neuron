import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { type ToastTone, useToasts } from "@/stores/toast";

const ICON: Record<ToastTone, typeof Info> = { info: Info, ok: CheckCircle2, warn: AlertTriangle, danger: XCircle };
const TONE: Record<ToastTone, string> = { info: "text-pending", ok: "text-ok", warn: "text-warn", danger: "text-danger" };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[360px] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-start gap-3 rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 shadow-lg shadow-black/40"
          >
            <Icon size={15} className={`mt-px shrink-0 ${TONE[t.tone]}`} />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                t.onClick?.();
                dismiss(t.id);
              }}
            >
              <p className="text-fg">{t.title}</p>
              {t.description && <p className="truncate text-xs text-fg-muted">{t.description}</p>}
            </button>
            <button
              type="button"
              aria-label="Fermer"
              className="rounded-sm p-0.5 text-fg-subtle transition-colors duration-fast hover:text-fg"
              onClick={() => dismiss(t.id)}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
