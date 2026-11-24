import { useEffect } from "react";
import { AlertCircle, Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { Button } from "@/components/ui/button";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGENTS } from "@/lib/agents";
import { useAccess } from "@/stores/access";
import { REFORMULATE_MAX_CHARS } from "./importOrigins";
import { locale, t } from "@/i18n";

/** Preferred agents for a rewrite, in this order. */
export const REFORMULATE_AGENTS: readonly AgentKind[] = ["claude_code", "codex", "antigravity"];

function isReformulateAgent(value: string): value is AgentKind {
  return REFORMULATE_AGENTS.some((agent) => agent === value);
}

interface ImportReformulateProps {
  /** Chosen agent, or null to use the default one (first installed and signed in). */
  agent: AgentKind | null;
  onAgentChange: (agent: AgentKind) => void;
  /** Start time of the running reformulation, null when idle. */
  runningSince: number | null;
  error: string | null;
  reformulated: boolean;
  textLength: number;
  disabled: boolean;
  onReformulate: (agent: AgentKind) => void;
  onRevert: () => void;
}

export function ImportReformulate({
  agent,
  onAgentChange,
  runningSince,
  error,
  reformulated,
  textLength,
  disabled,
  onReformulate,
  onRevert,
}: ImportReformulateProps) {
  const byAgent = useAccess((s) => s.byAgent);
  const loaded = useAccess((s) => s.loaded);

  useEffect(() => {
    if (!useAccess.getState().loaded) void useAccess.getState().load();
  }, []);

  const installed = REFORMULATE_AGENTS.filter((a) => byAgent[a]?.installed === true);
  const fallback = installed.find((a) => byAgent[a]?.loggedIn !== false) ?? installed[0] ?? null;
  const selected = agent !== null && installed.includes(agent) ? agent : fallback;

  const running = runningSince !== null;
  const tooLong = textLength > REFORMULATE_MAX_CHARS;
  const canRun = selected !== null && !running && !disabled && !tooLong;

  return (
    <section
      aria-label={t("memory.rewriteWithAi")}
      className="flex min-w-0 flex-col gap-2.5 rounded-lg border bg-muted/30 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("memory.rewriteWithAi")}</span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {reformulated && !running && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRevert}>
              <RotateCcw aria-hidden />
              <span>{t("memory.revertRaw")}</span>
            </Button>
          )}
          {installed.length > 0 && selected !== null && (
            <Select
              value={selected}
              disabled={running || disabled}
              onValueChange={(next) => {
                if (isReformulateAgent(next)) onAgentChange(next);
              }}
            >
              <SelectTrigger size="sm" aria-label={t("memory.rewriteAgentAria")} className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {installed.map((a) => (
                  <SelectItem key={a} value={a}>
                    <AgentLogo agent={a} size={14} className="shrink-0" />
                    <span>{AGENTS[a].label}</span>
                    {byAgent[a]?.loggedIn === false && (
                      <span className="text-xs text-muted-foreground">{t("memory.notSignedIn")}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canRun}
            onClick={() => {
              if (selected !== null) onReformulate(selected);
            }}
          >
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            <span>{t("memory.rewrite")}</span>
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {runningSince !== null && selected !== null ? (
          <>
            {t("memory.rewritingBy", { agent: AGENTS[selected].label })}{" "}
            <LiveTimer startedAt={runningSince} className="text-xs" />
          </>
        ) : tooLong ? (
          <span className="text-warn">
            {t("memory.tooLongForRewrite", { max: REFORMULATE_MAX_CHARS.toLocaleString(locale()) })}
          </span>
        ) : loaded && installed.length === 0 ? (
          t("memory.noAgentToRewrite")
        ) : (
          t("memory.rewriteOptional")
        )}
      </p>

      {error !== null && !running && (
        <Alert variant="destructive" className="animate-in fade-in-0 duration-150">
          <AlertCircle aria-hidden />
          <AlertTitle>{t("memory.rewriteFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
