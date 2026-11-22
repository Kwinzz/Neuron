import { memo, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";

type ThinkingItem = Extract<ChatItem, { kind: "thinking" }>;

export const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: ThinkingItem }) {
  const [manual, setManual] = useState<boolean | null>(null);

  if (!item.text.trim()) return null;

  const open = manual ?? item.streaming;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className="inline-flex w-fit items-center gap-2 text-sm text-fg-muted transition-colors duration-fast hover:text-fg"
      >
        <Brain size={14} className="shrink-0" />
        <span className="font-bold">Réflexion{item.streaming ? "…" : ""}</span>
        <ChevronRight
          size={14}
          className={`shrink-0 transition-transform duration-fast ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-1.5 ml-[7px] max-h-[320px] overflow-auto border-l-2 border-line-strong pl-3 text-sm italic text-fg-muted whitespace-pre-wrap select-text">
          {item.text}
        </div>
      )}
    </div>
  );
});
