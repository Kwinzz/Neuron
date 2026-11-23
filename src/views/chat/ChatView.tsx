import { useCallback, useEffect, useRef } from "react";
import { MessageSquare, XCircle } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { useScrollRoot } from "@/components/shell/ScrollRoot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHotkey } from "@/hooks/useHotkey";
import { STATUS } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { Composer } from "./Composer";
import { ThreadHeader } from "./ThreadHeader";
import { PlanFollowUp } from "./PlanFollowUp";
import { Timeline } from "./Timeline";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { useStickToBottom } from "./useStickToBottom";
import { AgentCursor } from "./AgentCursor";
import { selectAnyRevealing, useReveal } from "@/stores/reveal";
import { WorkingIndicator } from "./WorkingIndicator";
import "./chat.css";

const EMPTY_ITEMS: ChatItem[] = [];

export function ChatView({ threadId }: { threadId: string }) {
  const thread = useChat((s) => s.threads[threadId]);
  const active = useLive((s) => {
    const t = s.threads[threadId];
    return t ? STATUS[t.status].active : false;
  });
  const projectId = useLive((s) => s.threads[threadId]?.projectId ?? null);
  const agent = useLive((s) => s.threads[threadId]?.agent ?? "claude_code");
  const planMode = useLive((s) => s.threads[threadId]?.permissionMode === "plan");
  const revealing = useReveal(selectAnyRevealing);

  const scrollRoot = useScrollRoot();
  const contentRef = useRef<HTMLDivElement>(null);
  const { showPill, scrollToBottom } = useStickToBottom(scrollRoot, contentRef);

  useEffect(() => {
    void useChat.getState().load(threadId);
  }, [threadId]);

  // Échap stops the running agent — also from the composer, but never while a dialog/menu/popover is
  // open (they own Échap) or from a single-line input (chat rename).
  useHotkey(
    "escape",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
      void useChat.getState().stop(threadId);
    },
    { enabled: active, allowInInputs: true },
  );

  const loaded = thread?.loaded ?? false;
  const loading = thread?.loading ?? false;
  const error = thread?.error ?? null;
  const items = thread?.items ?? EMPTY_ITEMS;
  const last = items[items.length - 1];
  // "Working" while the agent is busy and nothing is streaming / waiting on the user.
  const working =
    active &&
    !(last && (last.kind === "text" || last.kind === "thinking") && last.streaming) &&
    !(last && last.kind === "permission" && last.state === "pending");

  useEffect(() => {
    if (loaded) {
      scrollToBottom(false);
    }
  }, [threadId, loaded, scrollToBottom]);

  const handleSent = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  const handlePillClick = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-4 px-4 md:px-6">
      {/* No bottom padding on this root: the sticky composer carries its own. Otherwise it shifts by that
          amount between "scrolled up" (pinned to the edge) and "at the bottom" (resting above the padding). */}
      <ThreadHeader threadId={threadId} />

      <div
        ref={contentRef}
        className="relative mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-4 pl-10"
      >
        {!loaded && (loading || thread === undefined) ? (
          <TimelineSkeleton />
        ) : !loaded && error ? (
          <Alert variant="destructive" className="p-4">
            <XCircle />
            <AlertTitle>Impossible de charger l'historique</AlertTitle>
            <AlertDescription className="col-start-2 select-text whitespace-pre-wrap break-words">
              {error}
            </AlertDescription>
            <div className="col-start-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                className="text-foreground"
                onClick={() => void useChat.getState().load(threadId, true)}
              >
                Réessayer
              </Button>
            </div>
          </Alert>
        ) : loaded && items.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="size-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold text-foreground">Nouvelle conversation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Envoyez un premier message pour démarrer l'agent.
            </p>
          </div>
        ) : (
          <Timeline items={items} threadId={threadId} agent={agent} />
        )}
        {loaded && working && <WorkingIndicator threadId={threadId} />}
        {/* Codex / Antigravity: no plan approval of their own, offer to run the plan once they answered. */}
        {loaded && planMode && !active && agent !== "claude_code" && agent !== "generic" && items[items.length - 1]?.kind === "turn" && (
          <PlanFollowUp threadId={threadId} />
        )}
        {/* Absolutely positioned in the column gutter; it skips itself when measuring the last element. */}
        {loaded && <AgentCursor containerRef={contentRef} agent={agent} visible={active || revealing} />}
      </div>

      <Composer
        threadId={threadId}
        projectId={projectId}
        active={active}
        onSent={handleSent}
        showPill={showPill}
        onPillClick={handlePillClick}
        timelineGutter
      />
    </div>
  );
}
