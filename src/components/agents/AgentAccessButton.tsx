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
import { t } from "@/i18n";

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
              ? t("settings.installing")
              : t("settings.signingIn")}
          </span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size={size === "xs" ? "icon-xs" : "icon-sm"}
              variant="ghost"
              aria-label={t("settings.stopWaiting")}
              onClick={() => useAccess.getState().cancel(agent)}
            >
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("settings.stopWaiting")}</TooltipContent>
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
        action === "install"
          ? t("settings.installAgent", { agent: label })
          : t("settings.signInAgent", { agent: label })
      }
    >
      {action === "install" ? <Download aria-hidden /> : <LogIn aria-hidden />}
      <span>{action === "install" ? t("settings.install") : t("settings.signIn")}</span>
    </Button>
  );
}
