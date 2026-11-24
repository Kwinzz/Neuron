import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Info, Plug } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { CardSectionLabel } from "@/views/project/CardSectionLabel";

const MCP_TOOLS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: "neuron_memory_read",
    description: "Lit toute la mémoire, groupée par catégorie.",
  },
  {
    name: "neuron_memory_search",
    description: "Recherche plein texte dans les souvenirs.",
  },
  {
    name: "neuron_memory_save",
    description: "Enregistre un nouveau souvenir durable.",
  },
  {
    name: "neuron_memory_update",
    description: "Corrige un souvenir (texte ou catégorie).",
  },
  {
    name: "neuron_memory_delete",
    description: "Retire un souvenir devenu faux.",
  },
  {
    name: "neuron_project_context_read",
    description: "Lit le .neuron/context.md du projet du chat.",
  },
  {
    name: "neuron_project_context_update",
    description: "Met à jour le .neuron/context.md du projet.",
  },
];

export function AgentsMcpCard() {
  const info = useMemory((s) => s.info);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible de copier la commande",
        description: ipcErrorMessage(err),
      });
    }
  };

  return (
    <Card
      size="sm"
      className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Agents & MCP</span>
        </CardTitle>
        <CardDescription>
          Les agents lisent et enrichissent la mémoire en direct via le serveur
          MCP de Neuron (état par agent dans « Fournisseurs IA »).
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3.5">
        {info && !info.mcpEnabled && (
          <Alert>
            <Info aria-hidden />
            <AlertTitle>Serveur MCP désactivé</AlertTitle>
          </Alert>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <CardSectionLabel>Outils exposés</CardSectionLabel>
          <ul className="flex min-w-0 flex-col gap-2">
            {MCP_TOOLS.map((tool) => (
              <li key={tool.name} className="flex min-w-0 flex-col gap-0.5">
                <code className="truncate font-mono text-xs text-foreground">
                  {tool.name}
                </code>
                <span className="text-xs text-muted-foreground">
                  {tool.description}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <Collapsible className="flex min-w-0 flex-col gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="group -mx-2 w-fit justify-start gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
                aria-hidden
              />
              <span>Commande du serveur</span>
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="min-w-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150">
            {info ? (
              <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-muted/30 p-2.5">
                <code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere text-foreground">
                  {info.mcpCommand}
                </code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Copier la commande"
                      onClick={() => void handleCopyCommand(info.mcpCommand)}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="text-ok" aria-hidden />
                      ) : (
                        <Copy aria-hidden />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? "Copié" : "Copier"}</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <Skeleton className="h-10 w-full rounded-lg" />
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
