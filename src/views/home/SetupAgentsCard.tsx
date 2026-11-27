import { useEffect, useMemo } from "react";
import { cn } from "cn";
import { Check, CircleHelp, CircleSlash, RefreshCw, Settings, Sparkles, TriangleAlert } from "lucide-react";
import type { AgentAccess } from "@/bindings/AgentAccess";
import { AgentAccessButton } from "@/components/agents/AgentAccessButton";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { AGENTS } from "@/lib/agents";
import { accessIssue, MANAGED_AGENTS, useAccess } from "@/stores/access";
import { useUi } from "@/stores/ui";

function agentStateLabel(access: AgentAccess | undefined) {
  if (!access) {
    return (
      <span className="text-xs text-muted-foreground">{t("settings.unknownState")}</span>
    );
  }
  if (!access.installed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleSlash className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("settings.notInstalled")}</span>
      </span>
    );
  }
  if (access.loggedIn === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("settings.installedNotSignedIn")}</span>
      </span>
    );
  }
  if (access.loggedIn === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleHelp className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("settings.installedUnverifiable")}</span>
      </span>
    );
  }
  return (
    <span className="truncate text-xs text-muted-foreground">
      {access.account ? t("settings.signedInAs", { account: access.account }) : t("settings.signedIn")}
    </span>
  );
}

/**
 * Shown on Accueil only while at least one managed agent is not installed or not signed in.
 * Lists each managed agent with its status and the Install / Sign in action; disappears once all are ready.
 */
export function SetupAgentsCard() {
  const loaded = useAccess((s) => s.loaded);
  const loading = useAccess((s) => s.loading);
  const byAgent = useAccess((s) => s.byAgent);

  useEffect(() => {
    if (!useAccess.getState().loaded) {
      void useAccess.getState().load();
    }
  }, []);

  const needsSetup = useMemo(
    () => MANAGED_AGENTS.some((agent) => accessIssue(byAgent[agent]) !== null),
    [byAgent],
  );

  if (!loaded || !needsSetup) return null;

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("home.setupAgentsTitle")}</span>
        </CardTitle>
        <CardDescription>{t("home.setupAgentsDescription")}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("settings.recheck")}
                disabled={loading}
                onClick={() => void useAccess.getState().load(true)}
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.recheck")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("settings.navAgents")}
                onClick={() => useUi.getState().openSettings("agents")}
              >
                <Settings className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.navAgents")}</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ul className="grid grid-cols-1 gap-2.5 @3xl/main:grid-cols-3">
          {MANAGED_AGENTS.map((agent) => {
            const access = byAgent[agent];
            const issue = accessIssue(access);
            return (
              <li
                key={agent}
                className="flex min-w-0 items-center gap-3 rounded-lg border bg-background/50 p-3"
              >
                <AgentLogo agent={agent} size={18} className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {AGENTS[agent].label}
                  </span>
                  {agentStateLabel(access)}
                </div>
                {access && (
                  <div className="shrink-0">
                    {issue ? (
                      <AgentAccessButton agent={agent} issue={issue} />
                    ) : access.loggedIn === null ? (
                      <AgentAccessButton agent={agent} issue="not_logged_in" variant="outline" />
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Check className="text-ok" aria-hidden />
                        <span>{t("settings.ready")}</span>
                      </Badge>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
