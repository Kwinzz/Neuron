import { isValidElement, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type CodeChildProps = { className?: string; children?: ReactNode };

function isCodeElement(node: ReactNode): node is ReactElement<CodeChildProps> {
  return isValidElement<CodeChildProps>(node);
}

function extractLanguage(children: ReactNode): string | null {
  if (!isCodeElement(children)) return null;
  const cls = children.props.className;
  if (typeof cls !== "string") return null;
  const match = /language-(\S+)/.exec(cls);
  return match?.[1] ?? null;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const language = extractLanguage(children);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = () => {
    const raw = textOf(children);
    void navigator.clipboard
      .writeText(raw)
      .then(() => {
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="md-code my-3 overflow-hidden rounded-lg border bg-muted/40 animate-in fade-in-0 slide-in-from-bottom-1 zoom-in-[0.99] duration-300">
      <div className="flex h-8 items-center justify-between border-b px-3">
        <span className="font-mono text-xs text-muted-foreground">{language ?? "texte"}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleCopy}
          className={cn(
            "transition-colors duration-150 active:scale-95",
            copied ? "text-ok hover:text-ok" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {copied ? (
            <>
              <Check className="animate-in zoom-in-75 fade-in-0 duration-150" />
              Copié
            </>
          ) : (
            <>
              <Copy />
              Copier
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}
