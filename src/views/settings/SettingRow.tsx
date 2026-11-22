import type { ReactNode } from "react";
import { cn } from "cn";
import { Label } from "@/components/ui/label";

export interface SettingRowProps {
  id: string;
  label: string;
  description?: string;
  control: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SettingRow({
  id,
  label,
  description,
  control,
  disabled = false,
  className,
}: SettingRowProps) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-4", className)}>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-0.5 transition-opacity duration-150",
          disabled && "opacity-50",
        )}
      >
        <Label
          htmlFor={id}
          className={cn("leading-snug text-foreground", disabled ? "cursor-not-allowed" : "cursor-pointer")}
        >
          {label}
        </Label>
        {description && (
          <p id={`${id}-desc`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}
