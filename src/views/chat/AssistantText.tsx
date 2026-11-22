import { type ComponentProps, memo } from "react";
import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { ChatItem } from "@/bindings/ChatItem";
import { CodeBlock } from "./CodeBlock";

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

export const AssistantText = memo(function AssistantText({ item }: { item: TextItem }) {
  return (
    <div className={cn("chat-prose select-text text-sm leading-7 text-foreground", item.streaming && "chat-streaming")}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {item.text}
      </ReactMarkdown>
      {/* Before the first block exists, show a standalone caret; afterwards chat.css draws it
          inline at the end of the last block (`.chat-streaming > :last-child::after`). */}
      {item.streaming && !item.text.trim() && <span className="chat-caret" aria-hidden />}
    </div>
  );
});
