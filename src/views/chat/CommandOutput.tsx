import { memo, useMemo, useState } from "react";
import { ChevronDown, SquareTerminal } from "lucide-react";
import { cn } from "cn";
import type { ChatItem } from "@/bindings/ChatItem";
import { Markdown } from "@/components/markdown/Markdown";
import { type OutputBlock, looksLikeMarkdown, splitOutput } from "./slashText";

type CommandItem = Extract<ChatItem, { kind: "command" }>;

function meterTone(percent: number): string {
  if (percent >= 90) return "bg-destructive";
  if (percent >= 70) return "bg-warn";
  return "bg-ok";
}

const Meter = memo(function Meter({ block }: { block: Extract<OutputBlock, { kind: "meter" }> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-foreground">{block.label}</span>
        <span className="shrink-0 font-mono tabular-nums text-foreground">{block.percent} %</span>
      </div>
      <div
        role="meter"
        aria-label={block.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={block.percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", meterTone(block.percent))}
          style={{ width: `${Math.min(100, Math.max(0, block.percent))}%` }}
        />
      </div>
      {block.note && <span className="text-[11px] text-muted-foreground">{block.note}</span>}
    </div>
  );
});

/** Output of a command the CLI ran itself (/usage, /context…): a dedicated card, not an assistant message. */
export const CommandOutput = memo(function CommandOutput({ item }: { item: CommandItem }) {
  const [open, setOpen] = useState(true);
  const markdown = useMemo(() => looksLikeMarkdown(item.output), [item.output]);
  const blocks = useMemo(() => (markdown ? [] : splitOutput(item.output)), [markdown, item.output]);

  if (!item.output.trim()) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent/50"
      >
        <SquareTerminal className="size-3.5 shrink-0" />
        <span className="font-mono text-foreground">/{item.name}</span>
        <span>· résultat de la commande</span>
        <ChevronDown
          className={cn("ml-auto size-3.5 shrink-0 opacity-60 transition-transform duration-150", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <div className="max-h-112 overflow-y-auto border-t px-3.5 py-3">
          {markdown ? (
            <Markdown size="xs">{item.output}</Markdown>
          ) : (
            <div className="flex flex-col gap-3">
              {blocks.map((block, i) =>
                block.kind === "meter" ? (
                  <Meter key={i} block={block} />
                ) : (
                  <pre
                    key={i}
                    className="whitespace-pre-wrap wrap-anywhere select-text font-mono text-xs leading-5 text-muted-foreground"
                  >
                    {block.text}
                  </pre>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
