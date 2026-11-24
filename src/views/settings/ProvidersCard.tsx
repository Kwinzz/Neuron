import { useEffect } from "react";
import {
  Check,
  CircleHelp,
  CircleSlash,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { AgentAccess } from "@/bindings/AgentAccess";
import type { AgentKind } from "@/bindings/AgentKind";
import { AgentAccessButton } from "@/components/agents/AgentAccessButton";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENTS } from "@/lib/agents";
import { cn } from "cn";
import { AgyMemoryLine } from "./AgyMemoryLine";
import { accessIssue, MANAGED_AGENTS, useAccess } from "@/stores/access";

/** Claude Code, Antigravity, Codex: installed? signed in? — with « Installer » / « Se connecter ». */
export function ProvidersCard() {
  const loaded = useAccess((s) => s.loaded);
  const loading = useAccess((s) => s.loading);

  useEffect(() => {
    void useAccess.getState().load(true);
  }, []);

  return (
    <Card
      size="sm"
      className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span>Fournisseurs IA</span>
        </CardTitle>
        <CardDescription>
          Les CLI que Neuron pilote. L'installation et la connexion s'ouvrent
          dans un terminal ; Neuron détecte la fin tout seul.
        </CardDescription>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Vérifier à nouveau"
                disabled={loading}
                onClick={() => void useAccess.getState().load(true)}
              >
                <RefreshCw
                  className={cn("size-4", loading && "animate-spin")}
                  aria-hidden
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Vérifier à nouveau</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="flex min-w-0 flex-col divide-y">
          {MANAGED_AGENTS.map((agent) => (
            <ProviderRow key={agent} agent={agent} loaded={loaded} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ProviderRow({ agent, loaded }: { agent: AgentKind; loaded: boolean }) {
  const access = useAccess((s) => s.byAgent[agent]);
  const issue = accessIssue(access);

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <AgentLogo agent={agent} size={18} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {AGENTS[agent].label}
            </span>
            {access?.version && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                v{access.version}
              </span>
            )}
          </span>
          {!access ? (
            loaded ? (
              <span className="text-xs text-muted-foreground">
                État inconnu
              </span>
            ) : (
              <Skeleton className="h-4 w-32" />
            )
          ) : (
            <StatusLine access={access} />
          )}
        </div>
        {access && (
          <div className="flex shrink-0 items-center gap-1.5">
            {issue ? (
              <AgentAccessButton agent={agent} issue={issue} />
            ) : access.loggedIn === null ? (
              <AgentAccessButton
                agent={agent}
                issue="not_logged_in"
                variant="outline"
              />
            ) : (
              <Badge variant="outline" className="gap-1">
                <Check className="text-ok" aria-hidden />
                <span>Prêt</span>
              </Badge>
            )}
          </div>
        )}
      </div>
      {/* Neuron memory (MCP): automatic for Claude / Codex sessions, registered once for Antigravity. */}
      {access?.installed && (
        <div className="min-w-0 pl-[30px]">
          {agent === "antigravity" ? (
            <AgyMemoryLine />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5 shrink-0 text-ok" aria-hidden />
              <span>Mémoire Neuron branchée à chaque session</span>
            </span>
          )}
        </div>
      )}
      {access && issue && (
        <p className="min-w-0 pl-[30px] text-xs text-muted-foreground">
          {issue === "not_installed" ? "Commande officielle : " : "Commande : "}
          <code className="font-mono wrap-anywhere text-foreground/80">
            {issue === "not_installed"
              ? access.installCommand
              : access.loginCommand}
          </code>
        </p>
      )}
    </li>
  );
}

function StatusLine({ access }: { access: AgentAccess }) {
  if (!access.installed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleSlash className="size-3.5 shrink-0" aria-hidden />
        <span>Non installé</span>
      </span>
    );
  }
  if (access.loggedIn === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        <span>Installé · non connecté</span>
      </span>
    );
  }
  if (access.loggedIn === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleHelp className="size-3.5 shrink-0" aria-hidden />
        <span>Installé · connexion non vérifiable</span>
      </span>
    );
  }
  return (
    <span className="truncate text-xs text-muted-foreground">
      Connecté{access.account ? ` · ${access.account}` : ""}
    </span>
  );
}
