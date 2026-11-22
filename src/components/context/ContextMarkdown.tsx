import { useState } from "react";
import { cn } from "cn";
import { Code, Eye } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ViewMode = "rendered" | "raw";

interface ContextMarkdownProps {
  markdown: string;
  size?: "xs" | "sm";
  className?: string;
}

export function ContextMarkdown({ markdown, size = "sm", className }: ContextMarkdownProps) {
  const [mode, setMode] = useState<ViewMode>("rendered");
  const isEmpty = markdown.trim().length === 0;
  const lineCount = isEmpty ? 0 : markdown.trimEnd().split("\n").length;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="font-mono">{lineCount}</span> {lineCount <= 1 ? "ligne" : "lignes"}
        </span>

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

      <div
        className={cn(
          "min-w-0 overflow-y-auto rounded-lg border bg-background/40",
          size === "xs" ? "p-3" : "p-4",
          className,
        )}
      >
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">Aucun contexte.</p>
        ) : mode === "rendered" ? (
          <Markdown size={size} doc>
            {markdown}
          </Markdown>
        ) : (
          <pre
            className={cn(
              "select-text font-mono whitespace-pre-wrap wrap-anywhere text-foreground",
              size === "xs" ? "text-xs leading-5" : "text-[13px] leading-6",
            )}
          >
            {markdown}
          </pre>
        )}
      </div>
    </div>
  );
}
