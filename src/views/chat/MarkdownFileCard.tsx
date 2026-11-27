import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, FileText } from "lucide-react";
import { cn } from "cn";
import { Markdown } from "@/components/markdown/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

/** Longer documents start folded to this height (« Afficher tout »). */
const FOLD_LINES = 40;

interface MarkdownFileCardProps {
  /** File name shown in the header (« plan.md »). */
  name: string;
  /** Full path, as a tooltip. */
  path?: string | null;
  content: string;
  /** Small label next to the name (« Plan »). */
  badge?: string;
  /** Muted text after the badge (« non retenu »). */
  note?: string;
  children?: ReactNode;
}

/** A Markdown file shown as a document in the chat: rendered preview or source, copy, fold. */
export const MarkdownFileCard = memo(function MarkdownFileCard({
  name,
  path,
  content,
  badge,
  note,
  children,
}: MarkdownFileCardProps) {
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const long = content.split("\n").length > FOLD_LINES;
  const folded = long && !expanded;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch {
      toast({ tone: "danger", title: t("chat.copyFailed") });
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className={cn("flex min-w-0 items-center gap-2 px-3 py-2", open && "border-b")}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90",
            )}
          />
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-foreground" title={path ?? name}>
            {name}
          </span>
          {badge && (
            <Badge variant="secondary" className="shrink-0">
              {badge}
            </Badge>
          )}
          {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
        </button>
        {open && (
          <div className="flex shrink-0 items-center gap-1">
            <div role="radiogroup" aria-label={t("chat.display")} className="inline-flex h-6 items-center rounded-md bg-muted p-0.5">
              {[
                { value: false, label: t("chat.preview") },
                { value: true, label: t("chat.source") },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={source === o.value}
                  onClick={() => setSource(o.value)}
                  className={cn(
                    "h-5 rounded-[4px] px-1.5 text-[11px] transition-colors duration-150",
                    source === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label={t("chat.copyMarkdown")}
              title={t("chat.copyMarkdown")}
              onClick={() => void copy()}
            >
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {open && (
        <>
          <div className={cn("relative", folded && "max-h-[28rem] overflow-hidden")}>
            {source ? (
              <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-foreground select-text">
                {content}
              </pre>
            ) : (
              <div className="px-5 py-4">
                <Markdown>{content}</Markdown>
              </div>
            )}
            {folded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card to-transparent" />
            )}
          </div>
          {long && (
            <div className="border-t px-4 py-1.5">
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0 text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t("chat.collapse") : t("chat.showAll")}
              </Button>
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
});
