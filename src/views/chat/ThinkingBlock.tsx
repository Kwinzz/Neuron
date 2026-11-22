import { memo, useState } from "react";
import { cn } from "cn";
import { Brain, ChevronRight } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type ThinkingItem = Extract<ChatItem, { kind: "thinking" }>;

export const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: ThinkingItem }) {
  const [manual, setManual] = useState<boolean | null>(null);

  if (!item.text.trim()) return null;

  const open = manual ?? item.streaming;

  return (
    <Collapsible open={open} onOpenChange={setManual} className="flex flex-col">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground hover:text-foreground"
        >
          <Brain />
          <span>Réflexion{item.streaming ? "…" : ""}</span>
          <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-2 max-h-80 overflow-auto data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down border-l-2 pl-3 text-sm italic leading-6 text-muted-foreground whitespace-pre-wrap select-text">
        {item.text}
      </CollapsibleContent>
    </Collapsible>
  );
});
