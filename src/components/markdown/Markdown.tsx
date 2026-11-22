import { type ComponentProps, memo, type ReactNode } from "react";
import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import "./markdown.css";

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;

const REMARK: ReactMarkdownProps["remarkPlugins"] = [remarkGfm];
const REHYPE: ReactMarkdownProps["rehypePlugins"] = [[rehypeHighlight, { detect: false }]];
const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

interface MarkdownProps {
  /** Source markdown. */
  children: string;
  /** "sm" = corps de texte (chat, éditeur) ; "xs" = popovers/aperçus compacts. Défaut "sm". */
  size?: "sm" | "xs";
  /** Mode document : affiche « Section vide » sous les titres sans contenu (aperçus de contexte). */
  doc?: boolean;
  /** Classes du wrapper (ex. "chat-streaming chat-reveal min-h-7"). Les blocs restent enfants DIRECTS du wrapper. */
  className?: string;
  /** Élément rendu après le contenu, dans le wrapper (ex. caret autonome du chat). */
  trailing?: ReactNode;
}

export const Markdown = memo(function Markdown({
  children,
  size = "sm",
  doc = false,
  className,
  trailing,
}: MarkdownProps) {
  return (
    <div
      className={cn(
        "md-prose select-text",
        size === "xs" ? "md-xs text-xs leading-5" : "text-sm leading-7",
        doc && "md-doc",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
      {trailing}
    </div>
  );
});
