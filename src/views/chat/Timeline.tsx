import { memo, useRef } from "react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ChatItem } from "@/bindings/ChatItem";
import { AssistantText } from "./AssistantText";
import { CommandOutput } from "./CommandOutput";
import { ErrorItem } from "./ErrorItem";
import { FileEditBlock } from "./FileEditBlock";
import { PermissionCard } from "./PermissionCard";
import { PlanApproval } from "./PlanApproval";
import { PlanBlock } from "./PlanBlock";
import { QuestionCard } from "./QuestionCard";
import { QuestionSummary } from "./QuestionSummary";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";
import { baseToolName } from "./toolMeta";
import { MarkdownFileCard } from "./MarkdownFileCard";
import { baseName, documentText, isDocument, isPlanName } from "./planDocs";
import { TurnMarker } from "./TurnMarker";
import { UserMessage } from "./UserMessage";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Claude edits whose input carries the change (chats from before the diffs were stored). */
const INPUT_DIFF_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

/** File modifications are shown as code blocks in the conversation; other tools as collapsed rows. */
function ToolItemView({ item }: { item: ToolItem }) {
  if (baseToolName(item.name) === "ExitPlanMode") return <PlanBlock item={item} />;
  if (baseToolName(item.name) === "AskUserQuestion") return <QuestionSummary item={item} />;
  // Claude's own plan file (Plan mode) duplicates the plan block: keep it as a collapsed row.
  const planFile = item.changes.some((c) => c.path.includes("/.claude/plans/"));
  if (item.status === "ok" && item.changes.length > 0 && !planFile) {
    return (
      <div className="flex flex-col gap-2">
        {item.changes.map((change) => {
          // Plans and Antigravity artifacts: the Markdown document itself, not its diff.
          const doc = isDocument(change) ? documentText(change) : null;
          return doc !== null ? (
            <MarkdownFileCard
              key={change.path}
              name={baseName(change.path)}
              path={change.path}
              content={doc}
              badge={isPlanName(change.path) ? "Plan" : undefined}
              note={change.kind === "update" ? "mis à jour" : undefined}
            />
          ) : (
            <FileEditBlock key={change.path} change={change} />
          );
        })}
      </div>
    );
  }
  const inputDiff = item.status === "ok" && INPUT_DIFF_TOOLS.has(baseToolName(item.name));
  return <ToolBlock item={item} defaultOpen={inputDiff} />;
}

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
      return <AssistantText item={item} fresh={fresh} agent={agent} threadId={threadId} />;
    case "thinking":
      return <ThinkingBlock item={item} />;
    case "tool":
      return <ToolItemView item={item} />;
    case "permission":
      return item.toolName === "ExitPlanMode" ? (
        <PlanApproval item={item} threadId={threadId} />
      ) : item.toolName === "AskUserQuestion" ? (
        <QuestionCard item={item} threadId={threadId} />
      ) : (
        <PermissionCard item={item} threadId={threadId} />
      );
    case "error":
      return <ErrorItem item={item} />;
    case "command":
      return <CommandOutput item={item} />;
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
  command: "animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
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
