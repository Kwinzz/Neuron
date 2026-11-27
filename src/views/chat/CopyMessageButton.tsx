import { memo, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

interface CopyMessageButtonProps {
  text: string;
  className?: string;
}

/** Ghost copy action for chat messages, with brief « Copié » check feedback. */
export const CopyMessageButton = memo(function CopyMessageButton({ text, className }: CopyMessageButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, 1500);
      })
      .catch(() => {
        toast({ tone: "danger", title: t("chat.copyFailed") });
      });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={copied ? "xs" : "icon-xs"}
          data-copied={copied || undefined}
          onClick={handleCopy}
          aria-label={copied ? t("common.copied") : t("common.copy")}
          className={cn(
            "transition-colors duration-150",
            copied ? "px-1.5 text-ok hover:text-ok" : "text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden />
              <span>{t("common.copied")}</span>
            </>
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{copied ? t("common.copied") : t("common.copy")}</TooltipContent>
    </Tooltip>
  );
});
