/**
 * Notification API used across the app, rendered by shadcn's <Toaster /> (sonner).
 * Kept as a tiny facade so callers don't depend on the toast library.
 */
import { toast as sonner } from "sonner";

export type ToastTone = "info" | "ok" | "warn" | "danger";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  /** Optional action (e.g. open the thread). */
  onClick?: () => void;
}

export function toast({ tone, title, description, onClick }: ToastInput, ttlMs = 5000): void {
  const options = {
    description,
    duration: ttlMs,
    ...(onClick ? { action: { label: "Ouvrir", onClick } } : {}),
  };
  switch (tone) {
    case "ok":
      sonner.success(title, options);
      break;
    case "warn":
      sonner.warning(title, options);
      break;
    case "danger":
      sonner.error(title, options);
      break;
    default:
      sonner.info(title, options);
  }
}
