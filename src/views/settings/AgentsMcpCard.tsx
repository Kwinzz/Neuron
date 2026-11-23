import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Info,
  Loader2,
  Plug,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AGENTS } from "@/lib/agents";
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
  const agy = useMemory((s) => s.agy);
  const info = useMemory((s) => s.info);

  const [pending, setPending] = useState<"connect" | "disconnect" | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleConnect = async () => {
    if (pending !== null) return;
    setPending("connect");
    try {
      await useMemory.getState().connectAgy();
      toast({ tone: "ok", title: "Antigravity connecté à la mémoire" });
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible de connecter Antigravity",
        description: ipcErrorMessage(err),
      });
    } finally {
      setPending(null);
    }
  };

  const handleDisconnect = async () => {
    if (pending !== null) return;
    setPending("disconnect");
    try {
      await useMemory.getState().disconnectAgy();
      toast({ tone: "ok", title: "Antigravity déconnecté" });
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible de déconnecter Antigravity",
        description: ipcErrorMessage(err),
      });
    } finally {
      setPending(null);
    }
  };

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
          Les agents lisent et enrichissent la mémoire en direct via le serveur MCP de
          Neuron.
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

        <div className="flex min-w-0 flex-col gap-2.5">
          <CardSectionLabel>Agents</CardSectionLabel>

          <ul className="flex min-w-0 flex-col gap-3">
            <li className="flex min-w-0 items-start gap-3">
              <AgentLogo agent="claude_code" size={16} className="mt-0.5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {AGENTS.claude_code.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  Connecté automatiquement à chaque session
                </span>
              </div>
              <Badge variant="outline" className="shrink-0 gap-1">
                <Check className="text-ok" aria-hidden />
                <span>Actif</span>
              </Badge>
            </li>

            <li className="flex min-w-0 items-start gap-3">
              <AgentLogo agent="codex" size={16} className="mt-0.5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {AGENTS.codex.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  Connecté automatiquement à chaque session
                </span>
              </div>
              <Badge variant="outline" className="shrink-0 gap-1">
                <Check className="text-ok" aria-hidden />
                <span>Actif</span>
              </Badge>
            </li>

            <li className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <AgentLogo agent="antigravity" size={16} className="mt-0.5 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">
                    {AGENTS.antigravity.label}
                  </span>

                  {agy === null ? (
                    <Skeleton className="h-5 w-24" />
                  ) : agy === "connected" ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="gap-1">
                        <Check className="text-ok" aria-hidden />
                        <span>Connecté</span>
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={pending !== null}
                        onClick={() => void handleDisconnect()}
                      >
                        {pending === "disconnect" && (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        )}
                        <span>Déconnecter</span>
                      </Button>
                    </div>
                  ) : agy === "not_connected" ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="text-xs text-muted-foreground">Non connecté</span>
                      <Button
                        type="button"
                        size="xs"
                        disabled={pending !== null}
                        onClick={() => void handleConnect()}
                      >
                        {pending === "connect" && (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        )}
                        <span>Connecter Antigravity</span>
                      </Button>
                    </div>
                  ) : agy === "outdated" ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="inline-flex items-start gap-1 text-xs text-warn">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>À reconnecter (chemin de Neuron changé)</span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={pending !== null}
                        onClick={() => void handleConnect()}
                      >
                        {pending === "connect" && (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        )}
                        <span>Reconnecter</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CircleSlash className="size-3.5 shrink-0" aria-hidden />
                        <span>agy introuvable</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Installe Antigravity puis rouvre cette page.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {agy === "not_connected" && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Antigravity n'accepte pas de serveur MCP par session : Neuron
                  l'inscrit une fois dans sa configuration (
                  <code className="font-mono">agy mcp add neuron</code>).
                </p>
              )}
            </li>
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
