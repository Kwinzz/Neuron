import { useState } from "react";
import { cn } from "cn";
import { Check, ChevronDown, FolderGit2, FolderMinus } from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { deviceOfProject } from "@/lib/deviceRouting";

interface HomeProjectPickerProps {
  projects: readonly ProjectSummary[];
  value: ProjectSummary | null;
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
}

/** Searchable project picker for the action-first Home prompt card (local & remote projects, or no project). */
export function HomeProjectPicker({ projects, value, onChange, disabled }: HomeProjectPickerProps) {
  const [open, setOpen] = useState(false);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 max-w-48 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground [&>svg:last-child]:transition-transform [&>svg:last-child]:duration-150 data-[state=open]:[&>svg:last-child]:rotate-180"
          aria-label={t("home.projectPickerAria")}
        >
          <FolderGit2 className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{value?.name ?? t("chat.noProject")}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command loop>
          <CommandInput placeholder={t("home.searchProjectPlaceholder")} />
          <CommandList className="max-h-60">
            <CommandEmpty>{t("home.noProjectMatch")}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={t("home.noProjectSearch")} onSelect={() => pick(null)}>
                <FolderMinus className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{t("chat.noProject")}</span>
                <Check className={cn("size-4 shrink-0", value === null ? "opacity-100" : "opacity-0")} aria-hidden />
              </CommandItem>
              {projects.map((p) => {
                const device = deviceOfProject(p.id);
                return (
                  <CommandItem key={p.id} value={`${p.name} ${p.path}`} onSelect={() => pick(p.id)}>
                    <FolderGit2 className="size-4 shrink-0" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        <DeviceBadge device={device} compact />
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{p.path}</span>
                    </div>
                    <Check
                      className={cn("size-4 shrink-0", value?.id === p.id ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
