import type { RefObject } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

export interface SidebarFilterProps {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Compact fuzzy-filter input at the top of the sidebar chat sections (Esc clears). */
export function SidebarFilter({ value, onChange, inputRef }: SidebarFilterProps) {
  return (
    <div className="px-2 pt-1 pb-0.5 group-data-[collapsible=icon]:hidden">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (value) {
                onChange("");
              } else {
                inputRef.current?.blur();
              }
            }
          }}
          placeholder={t("shell.filterChatsPlaceholder")}
          aria-label={t("shell.filterChatsAria")}
          className="h-7 rounded-md bg-background/60 pr-7 pl-7 text-xs shadow-none placeholder:text-muted-foreground/70 md:text-xs dark:bg-background/60"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label={t("shell.filterClear")}
            title={t("shell.filterClear")}
            className="absolute right-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring outline-hidden"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
