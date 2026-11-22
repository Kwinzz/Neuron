import { type ComponentProps, memo } from "react";
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
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  ),
};

export const AssistantText = memo(function AssistantText({ item }: { item: TextItem }) {
  return (
    <div className={`chat-prose select-text text-fg ${item.streaming ? "chat-streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {item.text}
      </ReactMarkdown>
      {/* Before the first block exists, show a standalone caret; afterwards chat.css draws it
          inline at the end of the last block (`.chat-streaming > :last-child::after`). */}
      {item.streaming && !item.text.trim() && <span className="chat-caret" aria-hidden />}
    </div>
  );
});
