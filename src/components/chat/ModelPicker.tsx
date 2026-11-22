import { memo, useEffect, useState } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ModelInfo } from "@/bindings/ModelInfo";
import { AgentLogo, VendorLogo } from "@/components/ui/AgentLogo";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AGENTS } from "@/lib/agents";
import { findModel, useModels } from "@/stores/models";

interface ModelPickerProps {
  agent: AgentKind;
  model: string | null;
  /** `model` null = provider default. */
  onChange: (agent: AgentKind, model: ModelInfo | null) => void;
  /** Existing chat: the provider can't change (a different CLI = a new chat). */
  lockAgent?: boolean;
  disabled?: boolean;
}

/** Searchable model picker, all providers, grouped with their logos. */
export const ModelPicker = memo(function ModelPicker({ agent, model, onChange, lockAgent, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const providers = useModels((s) => s.providers);
  const loading = useModels((s) => s.loading);

  useEffect(() => {
    void useModels.getState().load();
  }, []);

  const current = findModel(providers, agent, model);
  const label = current?.label ?? model ?? `${AGENTS[agent].label} · par défaut`;

  const pick = (a: AgentKind, m: ModelInfo | null) => {
    onChange(a, m);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 max-w-64 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground [&>svg:last-child]:transition-transform [&>svg:last-child]:duration-200 data-[state=open]:[&>svg:last-child]:rotate-180"
          aria-label="Modèle"
        >
          {current ? <VendorLogo vendor={current.vendor} size={14} /> : <AgentLogo agent={agent} size={14} />}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command loop>
          <CommandInput placeholder="Rechercher un modèle…" />
          <CommandList className="max-h-80">
            <CommandEmpty>{loading ? "Chargement des modèles…" : "Aucun modèle"}</CommandEmpty>
            {providers.map((p, i) => {
              const locked = Boolean(lockAgent) && p.agent !== agent;
              return (
                <div key={p.agent}>
                  {i > 0 && <CommandSeparator />}
                  <CommandGroup
                    heading={
                      <span className="flex items-center gap-1.5">
                        <AgentLogo agent={p.agent} size={12} />
                        {p.label}
                        {!p.available && <span className="font-normal text-destructive">· non installé</span>}
                        {locked && <span className="font-normal">· nouveau chat requis</span>}
                      </span>
                    }
                  >
                    <CommandItem
                      value={`${p.label} défaut`}
                      disabled={locked || !p.available}
                      onSelect={() => pick(p.agent, null)}
                    >
                      <AgentLogo agent={p.agent} size={14} />
                      <span className="flex-1">Modèle par défaut</span>
                      <Check className={cn("size-4", p.agent === agent && model === null ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                    {p.models.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={`${p.label} ${m.label} ${m.id}`}
                        disabled={locked || !p.available}
                        onSelect={() => pick(p.agent, m)}
                      >
                        <VendorLogo vendor={m.vendor} size={14} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{m.label}</span>
                          {(m.hint || m.effortModels) && (
                            <span className="truncate text-xs text-muted-foreground">
                              {[m.hint, m.effortModels ? `${m.efforts.length} niveaux de raisonnement` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                        <Check className={cn("size-4", p.agent === agent && current?.id === m.id ? "opacity-100" : "opacity-0")} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              );
            })}
          </CommandList>
          <div className="flex items-center justify-between border-t px-2 py-1.5 text-xs text-muted-foreground">
            <span>{lockAgent ? "Changer de fournisseur = nouveau chat" : "Tous fournisseurs confondus"}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => void useModels.getState().load(true)}
              disabled={loading}
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              Actualiser
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
