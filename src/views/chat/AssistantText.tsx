import { type ComponentProps, memo, useEffect } from "react";
import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { useReveal } from "@/stores/reveal";
import { CodeBlock } from "./CodeBlock";
import { useSmoothText } from "./useSmoothText";

type TextItem = Extract<ChatItem, { kind: "text" }>;
type MarkdownProps = ComponentProps<typeof ReactMarkdown>;

const REMARK: MarkdownProps["remarkPlugins"] = [remarkGfm];
const REHYPE: MarkdownProps["rehypePlugins"] = [[rehypeHighlight, { detect: false }]];
const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
    >
      {children}
    </a>
  ),
};

interface AssistantTextProps {
  item: TextItem;
  /** Arrived after the chat was opened: reveal it progressively. */
  fresh: boolean;
  /** Kept for the item API (the agent cursor now lives at the timeline level). */
  agent: AgentKind;
}

export const AssistantText = memo(function AssistantText({ item, fresh }: AssistantTextProps) {
  const { text, revealing } = useSmoothText(item.text, fresh || item.streaming);
  const writing = item.streaming || revealing;

  // Tell the timeline's agent cursor this text is still being written (it stays visible meanwhile).
  useEffect(() => {
    useReveal.getState().set(item.id, writing);
  }, [item.id, writing]);
  useEffect(() => () => useReveal.getState().set(item.id, false), [item.id]);

  return (
    <div
      className={cn(
        "chat-prose min-h-7 min-w-0 select-text text-sm leading-7 text-foreground",
        writing && "chat-streaming",
        fresh && "chat-reveal",
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
      {/* Before the first block exists, show a standalone caret; afterwards chat.css draws it
          inline at the end of the last block (`.chat-streaming > :last-child::after`). */}
      {writing && !text.trim() && <span className="chat-caret" aria-hidden />}
    </div>
  );
});
