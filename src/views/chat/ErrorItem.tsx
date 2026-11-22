import { memo } from "react";
import { XCircle } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { IconBox } from "@/components/ui/IconBox";

type ErrorChatItem = Extract<ChatItem, { kind: "error" }>;

export const ErrorItem = memo(function ErrorItem({ item }: { item: ErrorChatItem }) {
  return (
    <div className="glass-tile flex items-start gap-3 rounded-xl border border-danger/30 px-4 py-3">
      <IconBox tone="danger" size={30}>
        <XCircle size={15} strokeWidth={2} />
      </IconBox>
      <p className="min-w-0 flex-1 pt-1 text-sm text-fg whitespace-pre-wrap break-words select-text">
        {item.message}
      </p>
    </div>
  );
});
