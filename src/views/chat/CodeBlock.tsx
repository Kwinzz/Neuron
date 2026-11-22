import { isValidElement, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

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
    <div className="chat-code glass-tile my-3 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-1.5 text-xs">
        <span className="font-mono text-fg-subtle">{language ?? "texte"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-1.5 font-bold transition-colors duration-fast ${
            copied ? "text-ok" : "text-fg-muted hover:text-fg"
          }`}
        >
          {copied ? (
            <>
              <Check size={13} />
              Copié ✓
            </>
          ) : (
            <>
              <Copy size={13} />
              Copier
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}
