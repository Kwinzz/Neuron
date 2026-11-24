import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORY_ORDER, categoryMeta, isMemoryCategory } from "./categories";
import { t } from "@/i18n";

interface CategoryPickerProps {
  value: MemoryCategory;
  onChange: (category: MemoryCategory) => void;
  size?: "xs" | "sm";
  disabled?: boolean;
}

export function CategoryPicker({
  value,
  onChange,
  size = "sm",
  disabled = false,
}: CategoryPickerProps) {
  const current = categoryMeta(value);
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          aria-label={t("memory.categoryAria", { label: current.label })}
          className="max-w-full"
        >
          <CurrentIcon className={cn("shrink-0", current.iconClass)} aria-hidden />
          <span className="truncate">{current.label}</span>
          <ChevronDown className="ml-0.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isMemoryCategory(next)) {
              onChange(next);
            }
          }}
        >
          {CATEGORY_ORDER.map((category) => {
            const meta = categoryMeta(category);
            const Icon = meta.icon;
            return (
              <DropdownMenuRadioItem key={category} value={category}>
                <Icon className={cn("size-3.5 shrink-0", meta.iconClass)} aria-hidden />
                <span>{meta.label}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
