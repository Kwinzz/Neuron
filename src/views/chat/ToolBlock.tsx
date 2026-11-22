import { memo, useState } from "react";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LiveTimer } from "@/components/ui/LiveTimer";
import { ToolBody } from "./ToolBody";
import { TOOL_STATUS, toolIcon } from "./toolMeta";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export const ToolBlock = memo(function ToolBlock({ item }: { item: ToolItem }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? item.status === "error";
  const statusMeta = TOOL_STATUS[item.status];
  const Icon = toolIcon(item.name);

  return (
    <Collapsible open={open} onOpenChange={setManual} className="rounded-lg border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
            open && "rounded-b-none",
          )}
        >
          <Icon
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              item.status === "running" && "chat-pulse text-live",
            )}
          />
          <span className="shrink-0 font-medium text-foreground">{item.name}</span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            title={item.activity ?? undefined}
          >
            {item.activity ?? ""}
          </span>
          {/* A settled tool without endedAt (denied, interrupted) must not tick forever. */}
          {(item.status === "running" || item.endedAt != null) && (
            <LiveTimer
              startedAt={item.startedAt}
              endedAt={item.endedAt}
              className="shrink-0 text-xs text-muted-foreground"
            />
          )}
          <Badge variant="outline" className={cn("shrink-0", statusMeta.text, statusMeta.border)}>
            {item.status === "running" && (
              <span className="size-1.5 rounded-full bg-live animate-pulse" aria-hidden />
            )}
            {statusMeta.label}
          </Badge>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-3">
        <ToolBody
          name={item.name}
          input={item.input}
          output={item.output}
          outputTone={item.status === "error" ? "danger" : "default"}
        />
      </CollapsibleContent>
    </Collapsible>
  );
});
