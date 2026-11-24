import { cn } from "cn";
import { Check, Minus } from "lucide-react";

interface ImportCheckboxProps {
  checked: boolean | "mixed";
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Small accessible checkbox (there is no shadcn checkbox in the project). Space toggles it natively. */
export function ImportCheckbox({ checked, onCheckedChange, label, disabled = false, className }: ImportCheckboxProps) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(checked !== true)}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        on && "border-primary bg-primary text-primary-foreground dark:bg-primary",
        className,
      )}
    >
      {checked === "mixed" ? (
        <Minus className="size-3" aria-hidden />
      ) : checked ? (
        <Check className="size-3" aria-hidden />
      ) : null}
    </button>
  );
}
