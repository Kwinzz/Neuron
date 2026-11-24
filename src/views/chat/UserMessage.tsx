import { memo } from "react";
import { SquareTerminal } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { MessageAttachments } from "@/components/attachments/MessageAttachments";
import { parseSlash } from "./slashText";
import { t } from "@/i18n";

type UserItem = Extract<ChatItem, { kind: "user" }>;

export const UserMessage = memo(function UserMessage({ item }: { item: UserItem }) {
  // « /usage », « /review … »: a discreet note instead of a message bubble.
  const slash = parseSlash(item.text);
  return (
    <div className="flex flex-col items-end gap-2">
      {item.attachments.length > 0 && <MessageAttachments items={item.attachments} align="end" />}
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
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground min-w-0 whitespace-pre-wrap wrap-anywhere select-text">
            {item.text}
          </div>
        )
      )}
    </div>
  );
});
