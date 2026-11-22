import { cn } from "cn";

export interface SettingSwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

export function SettingSwitch({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  className,
}: SettingSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border p-px transition-colors duration-150 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-primary" : "border-border bg-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block size-4 rounded-full shadow-xs transition-[transform,background-color] duration-150",
          checked ? "translate-x-4 bg-background" : "translate-x-0 bg-foreground/75",
        )}
      />
    </button>
  );
}
