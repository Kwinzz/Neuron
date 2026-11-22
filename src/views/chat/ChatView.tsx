import { useCallback, useEffect, useRef } from "react";
import { MessageSquare, XCircle } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { useScrollRoot } from "@/components/shell/ScrollRoot";
import { Button } from "@/components/ui/Button";
import { IconBox } from "@/components/ui/IconBox";
import { STATUS } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { Composer } from "./Composer";
import { ThreadHeader } from "./ThreadHeader";
import { Timeline } from "./Timeline";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { useStickToBottom } from "./useStickToBottom";
import "./chat.css";

const EMPTY_ITEMS: ChatItem[] = [];

export function ChatView({ threadId }: { threadId: string }) {
  const thread = useChat((s) => s.threads[threadId]);
  const active = useLive((s) => {
    const t = s.threads[threadId];
    return t ? STATUS[t.status].active : false;
  });
  const projectId = useLive((s) => s.threads[threadId]?.projectId ?? null);

  const scrollRoot = useScrollRoot();
  const contentRef = useRef<HTMLDivElement>(null);
  const { showPill, scrollToBottom } = useStickToBottom(scrollRoot, contentRef);

  useEffect(() => {
    void useChat.getState().load(threadId);
  }, [threadId]);

  const loaded = thread?.loaded ?? false;
  const loading = thread?.loading ?? false;
  const error = thread?.error ?? null;
  const items = thread?.items ?? EMPTY_ITEMS;

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
    <div className="flex min-h-full flex-col gap-4 px-6 pb-4">
      <ThreadHeader threadId={threadId} />

      <div
        ref={contentRef}
        className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-3"
      >
        {!loaded && (loading || thread === undefined) ? (
          <TimelineSkeleton />
        ) : !loaded && error ? (
          <div className="glass-tile flex items-start gap-3 rounded-xl border border-danger/30 p-5">
            <IconBox tone="danger" size={36}>
              <XCircle size={17} strokeWidth={2} />
            </IconBox>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-fg">Impossible de charger l'historique</div>
              <p className="mt-1 text-sm text-fg-muted whitespace-pre-wrap break-words select-text">
                {error}
              </p>
              <Button
                variant="subtle"
                size="sm"
                className="mt-3"
                onClick={() => void useChat.getState().load(threadId, true)}
              >
                Réessayer
              </Button>
            </div>
          </div>
        ) : loaded && items.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center py-12 text-center">
            <IconBox tone="brand" size={45}>
              <MessageSquare size={20} strokeWidth={2} />
            </IconBox>
            <h2 className="mt-4 text-lg font-bold text-fg">Nouvelle conversation</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Envoyez un premier message pour démarrer l'agent.
            </p>
          </div>
        ) : (
          <Timeline items={items} threadId={threadId} />
        )}
      </div>

      <Composer
        threadId={threadId}
        projectId={projectId}
        active={active}
        onSent={handleSent}
        showPill={showPill}
        onPillClick={handlePillClick}
      />
    </div>
  );
}
