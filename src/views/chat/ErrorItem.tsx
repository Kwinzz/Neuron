import { memo } from "react";
import { XCircle } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Alert, AlertDescription } from "@/components/ui/alert";

type ErrorChatItem = Extract<ChatItem, { kind: "error" }>;

export const ErrorItem = memo(function ErrorItem({ item }: { item: ErrorChatItem }) {
  return (
    <Alert variant="destructive" className="px-4 py-3">
      <XCircle />
      <AlertDescription className="col-start-2 min-w-0 whitespace-pre-wrap wrap-anywhere select-text text-destructive/90">
        {item.message}
      </AlertDescription>
    </Alert>
  );
});
