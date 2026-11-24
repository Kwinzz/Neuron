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
const NO_REHYPE: ReactMarkdownProps["rehypePlugins"] = [];
const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // Local files can't be loaded from markdown (the chat shows an agent's images under its message instead);
  // remote images are blocked by the CSP, so they become links.
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : "";
    if (url.startsWith("data:image/")) return <img src={url} alt={alt ?? ""} />;
    if (/^https?:/i.test(url)) {
      return (
        <a href={url} target="_blank" rel="noreferrer">
          {alt || url}
        </a>
      );
    }
    return null;
  },
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
  /**
   * Coloration syntaxique des blocs de code (défaut : oui). Désactivée pendant qu'une réponse s'écrit : le message
   * est ré-analysé à chaque mise à jour, colorer tous ses blocs à chaque fois saccade (surtout sous Linux).
   */
  highlight?: boolean;
}

export const Markdown = memo(function Markdown({
  children,
  size = "sm",
  doc = false,
  className,
  trailing,
  highlight = true,
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
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={highlight ? REHYPE : NO_REHYPE} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
      {trailing}
    </div>
  );
});
