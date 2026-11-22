import { memo } from "react";
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

export const Timeline = memo(function Timeline({
  items,
  threadId,
}: {
  items: ChatItem[];
  threadId: string;
}) {
  return (
    <>
      {items.map((item) => (
        <TimelineItem key={item.id} item={item} threadId={threadId} />
      ))}
    </>
  );
});
