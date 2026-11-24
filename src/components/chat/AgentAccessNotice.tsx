import { useEffect } from "react";
import { cn } from "cn";
import { CircleSlash, TriangleAlert } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import { AgentAccessButton } from "@/components/agents/AgentAccessButton";
import { AGENTS } from "@/lib/agents";
import { accessIssue, MANAGED_AGENTS, useAccess } from "@/stores/access";
import { t } from "@/i18n";

/** Above the composer: the chat's agent is not installed or signed out — fix it before sending. */
export function AgentAccessNotice({
  agent,
  timelineGutter = false,
}: {
  agent: AgentKind;
  timelineGutter?: boolean;
}) {
  const managed = MANAGED_AGENTS.includes(agent);
  const issue = useAccess((s) => accessIssue(s.byAgent[agent]));

  useEffect(() => {
    if (managed && !useAccess.getState().loaded)
      void useAccess.getState().load();
  }, [managed]);

  if (!managed || issue === null) return null;
  const label = AGENTS[agent].label;
  return (
    <div
      className={cn(
        "mx-auto mb-2 w-full max-w-3xl min-w-0",
        timelineGutter && "pl-10",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
        {issue === "not_installed" ? (
          <CircleSlash
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
        )}
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>{" "}
          {issue === "not_installed"
            ? t("chat.noticeNotInstalled")
            : t("chat.noticeSignedOut")}
        </p>
        <AgentAccessButton agent={agent} issue={issue} />
      </div>
    </div>
  );
}
