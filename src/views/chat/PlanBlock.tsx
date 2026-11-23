import { memo } from "react";
import { ClipboardList } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Markdown } from "@/components/markdown/Markdown";
import { asObject, str } from "./json";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Plan proposed by Claude in Plan mode (`ExitPlanMode`), rendered as a document instead of a tool row. */
export const PlanBlock = memo(function PlanBlock({ item }: { item: ToolItem }) {
  const plan = str(asObject(item.input), "plan") ?? "";
  // Refused from the approval bar: Claude keeps planning (the result is an error).
  const dropped = item.status === "error" || item.status === "denied";

  return (
    <div className="rounded-xl border bg-card animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">Plan proposé</span>
        {dropped && <span className="text-xs text-muted-foreground">· non retenu</span>}
      </div>
      <div className="px-4 py-3">
        {plan.trim() ? (
          <Markdown>{plan}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">Plan vide.</p>
        )}
      </div>
    </div>
  );
});
