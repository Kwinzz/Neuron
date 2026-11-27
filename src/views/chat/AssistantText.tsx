import { memo, useEffect, useMemo } from "react";
import { cn } from "cn";
import type { ChatItem } from "@/bindings/ChatItem";
import { Markdown } from "@/components/markdown/Markdown";
import { useReveal } from "@/stores/reveal";
import { AgentImages } from "./AgentImages";
import { CopyMessageButton } from "./CopyMessageButton";
import { stripAppDirectives } from "@/lib/appDirectives";
import { stripSummaryLine } from "@/lib/turnSummary";
import { useSmoothText } from "./useSmoothText";

type TextItem = Extract<ChatItem, { kind: "text" }>;

interface AssistantTextProps {
  item: TextItem;
  /** Arrived after the chat was opened: reveal it progressively. */
  fresh: boolean;
  threadId: string;
}

export const AssistantText = memo(function AssistantText({
  item,
  fresh,
  threadId,
}: AssistantTextProps) {
  // The agent's hidden summary line (for the notification) and directives meant for another app never show,
  // even mid-stream.
  const visible = useMemo(
    () => stripAppDirectives(stripSummaryLine(item.text), item.streaming),
    [item.text, item.streaming],
  );
  const { text, revealing } = useSmoothText(visible, fresh || item.streaming);
  const writing = item.streaming || revealing;

  // Tell the timeline's agent cursor this text is still being written (it stays visible meanwhile).
  useEffect(() => {
    useReveal.getState().set(item.id, writing);
  }, [item.id, writing]);
  useEffect(() => () => useReveal.getState().set(item.id, false), [item.id]);

  const copyable = visible.trimEnd();

  return (
    <div className="group/msg min-w-0">
      <Markdown
        highlight={!writing}
        streaming={writing}
        breaks
        className={cn(
          "min-h-7 min-w-0 text-foreground",
          writing && "chat-streaming",
          fresh && "chat-reveal",
        )}
        /* Before the first block exists, show a standalone caret; afterwards chat.css draws it
         inline at the end of the last block (`.chat-streaming > :last-child::after`). */
        trailing={
          writing && !text.trim() ? (
            <span className="chat-caret" aria-hidden />
          ) : null
        }
      >
        {text}
      </Markdown>
      {/* Images the agent produced or referenced, once its message is complete. */}
      {!writing && <AgentImages threadId={threadId} text={visible} />}
      {!writing && copyable.trim().length > 0 && (
        <div className="mt-1 -mb-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 has-data-[copied=true]:opacity-100">
          <CopyMessageButton text={copyable} />
        </div>
      )}
    </div>
  );
});
