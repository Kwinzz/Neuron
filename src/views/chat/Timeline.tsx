import { memo, useRef } from "react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
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
  fresh,
  agent,
}: {
  item: ChatItem;
  threadId: string;
  fresh: boolean;
  agent: AgentKind;
}) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "text":
      return <AssistantText item={item} fresh={fresh} agent={agent} />;
    case "thinking":
      return <ThinkingBlock item={item} />;
    case "tool":
      return <ToolBlock item={item} />;
    case "permission":
      return <PermissionCard item={item} threadId={threadId} />;
    case "error":
      return <ErrorItem item={item} />;
    case "turn":
      return <TurnMarker item={item} agent={agent} />;
  }
});

/** Entrance per kind: messages rise, tools/cards slide, markers fade. */
const ENTER: Record<ChatItem["kind"], string> = {
  user: "animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
  text: "",
  thinking: "animate-in fade-in-0 duration-300",
  tool: "",
  permission: "animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-[0.98] duration-300",
  error: "animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
  turn: "animate-in fade-in-0 duration-500",
};

export const Timeline = memo(function Timeline({
  items,
  threadId,
  agent,
}: {
  items: ChatItem[];
  threadId: string;
  agent: AgentKind;
}) {
  // Items present at first render (history) don't animate; only what arrives afterwards does.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(items.map((i) => i.id));
  const seen = initial.current;

  return (
    <>
      {items.map((item) => (
        <div key={item.id} className={cn("min-w-0", !seen.has(item.id) && ENTER[item.kind])}>
          <TimelineItem item={item} threadId={threadId} fresh={!seen.has(item.id)} agent={agent} />
        </div>
      ))}
    </>
  );
});
