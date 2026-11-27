import { memo } from "react";
import { Pencil, SquareTerminal } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { MessageAttachments } from "@/components/attachments/MessageAttachments";
import { Markdown } from "@/components/markdown/Markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fillComposer } from "@/stores/drafts";
import { CopyMessageButton } from "./CopyMessageButton";
import { parseSlash } from "./slashText";
import { t } from "@/i18n";

type UserItem = Extract<ChatItem, { kind: "user" }>;

interface UserMessageProps {
  item: UserItem;
  threadId: string;
  isLastUser?: boolean;
}

export const UserMessage = memo(function UserMessage({ item, threadId, isLastUser = false }: UserMessageProps) {
  // « /usage », « /review … »: a discreet note instead of a message bubble.
  const slash = parseSlash(item.text);
  return (
    <div className="group/msg flex flex-col items-end">
      {item.attachments.length > 0 && (
        <div className={item.text ? "mb-2" : undefined}>
          <MessageAttachments items={item.attachments} align="end" />
        </div>
      )}
      {slash ? (
        <div className="flex max-w-[80%] min-w-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <SquareTerminal className="size-3.5 shrink-0" />
            <span>
              {t("chat.commandUsedPrefix")} <span className="font-mono text-foreground">/{slash.name}</span>{" "}
              {t("chat.commandUsedSuffix")}
            </span>
          </div>
          {slash.args && (
            <p className="line-clamp-3 whitespace-pre-wrap wrap-anywhere select-text text-right">{slash.args}</p>
          )}
        </div>
      ) : (
        item.text && (
          // Written in Markdown like the answers; a single line break stays a line break.
          <div className="user-bubble max-w-[80%] min-w-0 rounded-2xl bg-muted px-4 py-2.5">
            <Markdown breaks className="leading-6">
              {item.text}
            </Markdown>
          </div>
        )
      )}
      {item.text && (
        <div className="mt-1 -mb-2 flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 has-data-[copied=true]:opacity-100">
          {isLastUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => fillComposer(threadId, item.text)}
                  aria-label={t("common.edit")}
                  className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("common.edit")}</TooltipContent>
            </Tooltip>
          )}
          <CopyMessageButton text={item.text} />
        </div>
      )}
    </div>
  );
});
