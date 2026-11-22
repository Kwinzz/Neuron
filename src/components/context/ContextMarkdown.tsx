import { type ComponentProps, useMemo, useState } from "react";
import { cn } from "cn";
import { Code, Eye } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import "@/views/chat/chat.css";

type MarkdownProps = ComponentProps<typeof ReactMarkdown>;
type ViewMode = "rendered" | "raw";

const REMARK: MarkdownProps["remarkPlugins"] = [remarkGfm];

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

interface ContextMarkdownProps {
  markdown: string;
  size?: "xs" | "sm";
  className?: string;
}

export function ContextMarkdown({ markdown, size = "sm", className }: ContextMarkdownProps) {
  const [mode, setMode] = useState<ViewMode>("rendered");
  const isEmpty = markdown.trim().length === 0;

  const rendered = useMemo(
    () => (
      <div className={cn("chat-prose select-text text-foreground", size === "xs" ? "text-xs leading-5" : "text-sm leading-6")}>
        <ReactMarkdown remarkPlugins={REMARK} components={COMPONENTS}>
          {markdown}
        </ReactMarkdown>
      </div>
    ),
    [markdown, size],
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-end">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={mode}
          onValueChange={(value) => {
            if (value === "rendered" || value === "raw") setMode(value);
          }}
        >
          <ToggleGroupItem value="rendered" aria-label="Affichage rendu">
            <Eye aria-hidden />
            <span>Rendu</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="raw" aria-label="Affichage brut">
            <Code aria-hidden />
            <span>Brut</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={cn("min-w-0 overflow-y-auto rounded-lg border bg-muted/30 p-3", className)}>
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">Aucun contexte.</p>
        ) : mode === "rendered" ? (
          rendered
        ) : (
          <pre className="select-text font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-foreground">
            {markdown}
          </pre>
        )}
      </div>
    </div>
  );
}
