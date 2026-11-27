import { memo, useCallback, useEffect, useState } from "react";
import { CircleCheck, RotateCcw, XCircle } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { AgentAccessButton } from "@/components/agents/AgentAccessButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AGENTS } from "@/lib/agents";
import { STATUS } from "@/lib/status";
import { accessIssue, MANAGED_AGENTS, useAccess } from "@/stores/access";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { t } from "@/i18n";

type ErrorChatItem = Extract<ChatItem, { kind: "error" }>;
type UserChatItem = Extract<ChatItem, { kind: "user" }>;

function findLastUserMessage(threadId: string): UserChatItem | undefined {
  const items = useChat.getState().threads[threadId]?.items;
  if (!items) return undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it?.kind === "user") return it;
  }
  return undefined;
}

export const ErrorItem = memo(function ErrorItem({
  item,
  agent,
  threadId,
  canResend = false,
}: {
  item: ErrorChatItem;
  agent: AgentKind;
  threadId: string;
  canResend?: boolean;
}) {
  const active = useLive((s) => {
    const thread = s.threads[threadId];
    return thread ? STATUS[thread.status].active : false;
  });
  const [resending, setResending] = useState(false);

  const handleResend = useCallback(async () => {
    if (resending || active) return;
    const lastUser = findLastUserMessage(threadId);
    if (!lastUser) return;
    setResending(true);
    try {
      await useChat.getState().send(threadId, lastUser.text, lastUser.attachments);
    } finally {
      setResending(false);
    }
  }, [active, resending, threadId]);

  const resendDisabled = active || resending;
  const fixable = item.issue !== null && MANAGED_AGENTS.includes(agent);
  if (!fixable || item.issue === null) {
    return (
      <Alert variant="destructive" className="px-4 py-3">
        <XCircle />
        <AlertDescription className="col-start-2 min-w-0 whitespace-pre-wrap wrap-anywhere select-text text-destructive/90">
          {item.message}
        </AlertDescription>
        {canResend && (
          <div className="col-start-2 mt-2.5 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-foreground"
              disabled={resendDisabled}
              onClick={() => void handleResend()}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("chat.resend")}
            </Button>
          </div>
        )}
      </Alert>
    );
  }
  return (
    <AccessErrorItem
      item={item}
      agent={agent}
      issue={item.issue}
      canResend={canResend}
      resendDisabled={resendDisabled}
      onResend={handleResend}
    />
  );
});

/** The agent is missing or signed out: say so plainly and offer the fix. */
function AccessErrorItem({
  item,
  agent,
  issue,
  canResend,
  resendDisabled,
  onResend,
}: {
  item: ErrorChatItem;
  agent: AgentKind;
  issue: NonNullable<ErrorChatItem["issue"]>;
  canResend: boolean;
  resendDisabled: boolean;
  onResend: () => Promise<void>;
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
          ? t("chat.agentReady", { agent: label })
          : issue === "not_installed"
            ? t("chat.agentNotInstalled", { agent: label })
            : t("chat.agentSignedOut", { agent: label })}
      </AlertTitle>
      <AlertDescription className="col-start-2 min-w-0 select-text">
        <span className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {item.message}
        </span>
        {!fixed ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <AgentAccessButton agent={agent} issue={issue} size="sm" />
            {canResend && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-foreground"
                disabled={resendDisabled}
                onClick={() => void onResend()}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("chat.resend")}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {issue === "not_installed"
                ? t("chat.terminalInstaller")
                : t("chat.terminalLogin")}
            </span>
          </div>
        ) : (
          canResend && (
            <div className="mt-2.5 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-foreground"
                disabled={resendDisabled}
                onClick={() => void onResend()}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("chat.resend")}
              </Button>
            </div>
          )
        )}
      </AlertDescription>
    </Alert>
  );
}
