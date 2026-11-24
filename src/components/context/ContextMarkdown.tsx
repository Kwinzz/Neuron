import { useState } from "react";
import { cn } from "cn";
import { Code, Eye } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";

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
          <span className="font-mono">{lineCount}</span> {t("project.ctxLineWord", { n: lineCount })}
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
          <ToggleGroupItem value="rendered" aria-label={t("project.ctxRenderedAria")}>
            <Eye aria-hidden />
            <span>{t("project.ctxRendered")}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="raw" aria-label={t("project.ctxRawAria")}>
            <Code aria-hidden />
            <span>{t("project.ctxRaw")}</span>
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
          <p className="text-xs text-muted-foreground">{t("project.ctxEmpty")}</p>
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
