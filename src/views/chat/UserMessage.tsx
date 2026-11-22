import { memo } from "react";
import type { ChatItem } from "@/bindings/ChatItem";

type UserItem = Extract<ChatItem, { kind: "user" }>;

export const UserMessage = memo(function UserMessage({ item }: { item: UserItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl rounded-br-sm bg-brand px-4 py-3 text-sm text-white whitespace-pre-wrap break-words select-text">
        {item.text}
      </div>
    </div>
  );
});
