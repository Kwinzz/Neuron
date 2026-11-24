import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/stores/toast";
import { webExportPrompt } from "./importOrigins";
import { t } from "@/i18n";

const COPIED_MS = 1500;

interface CopyPromptHintProps {
  /** Assistant name, e.g. « ChatGPT ». */
  assistant: string;
}

/** Web assistants have no memory export: tell the user what to ask, with a copyable prompt. */
export function CopyPromptHint({ assistant }: CopyPromptHintProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webExportPrompt());
    } catch {
      toast({ tone: "danger", title: t("memory.copyPromptFailed") });
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, COPIED_MS);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
      <span>{t("memory.askAssistant", { assistant })}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 py-1.5 pr-1.5 pl-2.5">
        <span className="min-w-0 flex-1 text-foreground select-text">{webExportPrompt()}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handleCopy()}
          aria-label={copied ? t("memory.promptCopied") : t("memory.copyPrompt")}
        >
          {copied ? <Check className="text-ok" aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
      <span>{t("memory.thenPaste")}</span>
    </div>
  );
}
