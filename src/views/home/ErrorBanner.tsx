import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/legacy/Button";
import { IconBox } from "@/components/ui/IconBox";
import { useDashboard } from "@/stores/dashboard";

/** Dashboard load error with a retry action. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="glass-card flex items-center justify-between gap-3 px-[22px] py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <IconBox tone="danger" size={30}>
          <AlertTriangle size={16} />
        </IconBox>
        <span className="truncate text-sm text-fg" title={message}>
          {message}
        </span>
      </div>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => {
          void useDashboard.getState().load();
        }}
      >
        Réessayer
      </Button>
    </div>
  );
}
