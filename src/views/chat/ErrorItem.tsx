import { memo, useEffect, useState } from "react";
import { CircleCheck, XCircle } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { AgentAccessButton } from "@/components/agents/AgentAccessButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AGENTS } from "@/lib/agents";
import { accessIssue, MANAGED_AGENTS, useAccess } from "@/stores/access";

type ErrorChatItem = Extract<ChatItem, { kind: "error" }>;

export const ErrorItem = memo(function ErrorItem({
  item,
  agent,
}: {
  item: ErrorChatItem;
  agent: AgentKind;
}) {
  const fixable = item.issue !== null && MANAGED_AGENTS.includes(agent);
  if (!fixable || item.issue === null) {
    return (
      <Alert variant="destructive" className="px-4 py-3">
        <XCircle />
        <AlertDescription className="col-start-2 min-w-0 whitespace-pre-wrap wrap-anywhere select-text text-destructive/90">
          {item.message}
        </AlertDescription>
      </Alert>
    );
  }
  return <AccessErrorItem item={item} agent={agent} issue={item.issue} />;
});

/** The agent is missing or signed out: say so plainly and offer the fix. */
function AccessErrorItem({
  item,
  agent,
  issue,
}: {
  item: ErrorChatItem;
  agent: AgentKind;
  issue: NonNullable<ErrorChatItem["issue"]>;
}) {
  const access = useAccess((s) => s.byAgent[agent]);
  const label = AGENTS[agent].label;
  const [shownAt] = useState(() => Date.now());
  // The cached state may predate this error: ask the CLI again.
  useEffect(() => {
    void useAccess.getState().check(agent);
  }, [agent]);
  // Fixed since (checked after this error was shown): nothing left to do but resend.
  const fixed =
    access !== undefined &&
    access.checkedAt >= shownAt &&
    accessIssue(access) === null &&
    access.loggedIn !== null;

  return (
    <Alert variant={fixed ? "default" : "destructive"} className="px-4 py-3">
      {fixed ? <CircleCheck className="text-ok" /> : <XCircle />}
      <AlertTitle className={fixed ? "text-foreground" : undefined}>
        {fixed
          ? `${label} est prêt : renvoie ton message.`
          : issue === "not_installed"
            ? `${label} n'est pas installé`
            : `${label} n'est pas connecté à ton compte`}
      </AlertTitle>
      <AlertDescription className="col-start-2 min-w-0 select-text">
        <span className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {item.message}
        </span>
        {!fixed && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <AgentAccessButton agent={agent} issue={issue} size="sm" />
            <span className="text-xs text-muted-foreground">
              {issue === "not_installed"
                ? "Un terminal s'ouvre avec l'installateur officiel."
                : "Un terminal s'ouvre pour la connexion."}
            </span>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
