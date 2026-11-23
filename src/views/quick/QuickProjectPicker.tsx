import { cn } from "cn";
import { Check, ChevronDown, FolderGit2, FolderMinus } from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface QuickProjectPickerProps {
  projects: ProjectSummary[];
  value: ProjectSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (projectId: string | null) => void;
}

/** Project of the quick prompt: the new chat is created in it and the list shows its chats. */
export function QuickProjectPicker({ projects, value, open, onOpenChange, onChange }: QuickProjectPickerProps) {
  const pick = (id: string | null) => {
    onChange(id);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 max-w-44 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground"
          aria-label="Projet"
        >
          <FolderGit2 className="size-3.5" />
          <span className="truncate">{value?.name ?? "Sans projet"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command loop>
          <CommandInput placeholder="Rechercher un projet…" />
          <CommandList className="max-h-52">
            <CommandEmpty>Aucun projet</CommandEmpty>
            <CommandGroup>
              <CommandItem value="sans projet aucun" onSelect={() => pick(null)}>
                <FolderMinus className="size-4" />
                <span className="flex-1">Sans projet</span>
                <Check className={cn("size-4", value === null ? "opacity-100" : "opacity-0")} />
              </CommandItem>
              {projects.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.path}`} onSelect={() => pick(p.id)}>
                  <FolderGit2 className="size-4" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{p.path}</span>
                  </div>
                  <Check className={cn("size-4", value?.id === p.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
