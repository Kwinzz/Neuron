import type { ReactNode } from "react";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

interface CardEmptyProps {
  icon: LucideIcon;
  children: ReactNode;
  tone?: "muted" | "ok";
}

export function CardEmpty({ icon: Icon, children, tone = "muted" }: CardEmptyProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
      <Icon
        className={cn("size-3.5 shrink-0", tone === "ok" ? "text-ok" : "text-muted-foreground")}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
