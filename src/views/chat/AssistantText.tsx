import { type ComponentProps, memo, useLayoutEffect, useRef, useState } from "react";
import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { AgentLogo } from "@/components/ui/AgentLogo";
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

/** Height of one text line (leading-7) — the logo sits on the line being written. */
const LINE = 28;

interface AssistantTextProps {
  item: TextItem;
  /** Arrived after the chat was opened: reveal it progressively. */
  fresh: boolean;
  agent: AgentKind;
}

export const AssistantText = memo(function AssistantText({ item, fresh, agent }: AssistantTextProps) {
  const { text, revealing } = useSmoothText(item.text, fresh || item.streaming);
  const writing = item.streaming || revealing;
  const boxRef = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);

  // Follow the last written line: the logo glides down as the block grows.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !writing) return;
    const update = () => setY(Math.max(0, el.offsetHeight - LINE));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [writing]);

  return (
    <div className="relative min-w-0 pl-10">
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 transition-[transform,opacity] duration-300 ease-out will-change-transform",
          writing ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ transform: `translateY(${y}px)` }}
      >
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg border bg-card",
            writing && "chat-working-logo",
          )}
        >
          <AgentLogo agent={agent} size={15} />
        </span>
      </span>

      <div
        ref={boxRef}
        className={cn(
          "chat-prose min-h-7 select-text text-sm leading-7 text-foreground",
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
    </div>
  );
});
