import { memo } from "react";
import type { ChatItem } from "@/bindings/ChatItem";

type UserItem = Extract<ChatItem, { kind: "user" }>;

export const UserMessage = memo(function UserMessage({ item }: { item: UserItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground min-w-0 whitespace-pre-wrap wrap-anywhere select-text">
        {item.text}
      </div>
    </div>
  );
});
