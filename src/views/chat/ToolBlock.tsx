import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { IconBox } from "@/components/ui/IconBox";
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
    <div className="glass-tile rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-surface/40 ${
          open ? "rounded-t-xl" : "rounded-xl"
        }`}
      >
        <IconBox
          tone={statusMeta.tone}
          size={30}
          className={item.status === "running" ? "chat-pulse" : ""}
        >
          <Icon size={15} strokeWidth={2} />
        </IconBox>
        <span className="shrink-0 text-sm font-bold text-fg">{item.name}</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted"
          title={item.activity ?? undefined}
        >
          {item.activity ?? ""}
        </span>
        {/* A settled tool without endedAt (denied, interrupted) must not tick forever. */}
        {(item.status === "running" || item.endedAt != null) && (
          <LiveTimer
            startedAt={item.startedAt}
            endedAt={item.endedAt}
            className="shrink-0 text-xs text-fg-subtle"
          />
        )}
        <span className={`shrink-0 text-xs font-bold ${statusMeta.text}`}>{statusMeta.label}</span>
        <ChevronRight
          size={15}
          className={`shrink-0 text-fg-subtle transition-transform duration-fast ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <ToolBody
            name={item.name}
            input={item.input}
            output={item.output}
            outputTone={item.status === "error" ? "danger" : "default"}
          />
        </div>
      )}
    </div>
  );
});
