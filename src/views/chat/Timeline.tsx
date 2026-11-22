import { memo, useRef } from "react";
import { cn } from "cn";
import type { ChatItem } from "@/bindings/ChatItem";
import { AssistantText } from "./AssistantText";
import { ErrorItem } from "./ErrorItem";
import { PermissionCard } from "./PermissionCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";
import { TurnMarker } from "./TurnMarker";
import { UserMessage } from "./UserMessage";

const TimelineItem = memo(function TimelineItem({
  item,
  threadId,
}: {
  item: ChatItem;
  threadId: string;
}) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "text":
      return <AssistantText item={item} />;
    case "thinking":
      return <ThinkingBlock item={item} />;
    case "tool":
      return <ToolBlock item={item} />;
    case "permission":
      return <PermissionCard item={item} threadId={threadId} />;
    case "error":
      return <ErrorItem item={item} />;
    case "turn":
      return <TurnMarker item={item} />;
  }
});

/** Entrance per kind: messages rise, tools/cards slide, markers fade. */
const ENTER: Record<ChatItem["kind"], string> = {
  user: "animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
  text: "animate-in fade-in-0 duration-300",
  thinking: "animate-in fade-in-0 duration-300",
  tool: "",
  permission: "animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-[0.98] duration-300",
  error: "animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
  turn: "animate-in fade-in-0 duration-500",
};

export const Timeline = memo(function Timeline({
  items,
  threadId,
}: {
  items: ChatItem[];
  threadId: string;
}) {
  // Items present at first render (history) don't animate; only what arrives afterwards does.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(items.map((i) => i.id));
  const seen = initial.current;

  return (
    <>
      {items.map((item) => (
        <div key={item.id} className={cn("min-w-0", !seen.has(item.id) && ENTER[item.kind])}>
          <TimelineItem item={item} threadId={threadId} />
        </div>
      ))}
    </>
  );
});
