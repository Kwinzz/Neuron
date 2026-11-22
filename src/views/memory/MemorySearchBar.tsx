import type { KeyboardEvent, RefObject } from "react";
import { cn } from "cn";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MemorySearchBarProps {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function MemorySearchBar({ value, onChange, inputRef }: MemorySearchBarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && value.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      onChange("");
    }
  };

  return (
    <div className="relative flex min-w-0 items-center">
      <Search
        className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Rechercher dans la mémoire…"
        aria-label="Rechercher dans la mémoire"
        className={cn(
          "pl-8 [&::-webkit-search-cancel-button]:hidden",
          value.length > 0 && "pr-8",
        )}
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Effacer la recherche"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
