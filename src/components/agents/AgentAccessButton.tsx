import { Download, Loader2, LogIn, X } from "lucide-react";
import type { AccessIssue } from "@/bindings/AccessIssue";
import type { AgentKind } from "@/bindings/AgentKind";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENTS } from "@/lib/agents";
import { useAccess } from "@/stores/access";

interface AgentAccessButtonProps {
  agent: AgentKind;
  issue: AccessIssue;
  size?: "xs" | "sm";
  variant?: "default" | "outline";
}

/** « Installer » / « Se connecter » for an agent; while Neuron waits for the terminal: « En attente… » + annuler. */
export function AgentAccessButton({
  agent,
  issue,
  size = "xs",
  variant = "default",
}: AgentAccessButtonProps) {
  const pending = useAccess((s) => s.pending[agent]);
  const action = issue === "not_installed" ? "install" : "login";
  const label = AGENTS[agent].label;

  if (pending) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button type="button" size={size} variant="outline" disabled>
          <Loader2 className="animate-spin" aria-hidden />
          <span>
            {pending === "install"
              ? "Installation en cours…"
              : "Connexion en cours…"}
          </span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size={size === "xs" ? "icon-xs" : "icon-sm"}
              variant="ghost"
              aria-label="Arrêter d'attendre"
              onClick={() => useAccess.getState().cancel(agent)}
            >
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Arrêter d'attendre</TooltipContent>
        </Tooltip>
      </span>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={() => void useAccess.getState().start(agent, action)}
      aria-label={
        action === "install" ? `Installer ${label}` : `Se connecter à ${label}`
      }
    >
      {action === "install" ? <Download aria-hidden /> : <LogIn aria-hidden />}
      <span>{action === "install" ? "Installer" : "Se connecter"}</span>
    </Button>
  );
}
