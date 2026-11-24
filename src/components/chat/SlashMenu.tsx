import { memo, useEffect, useMemo, useRef } from "react";
import { cn } from "cn";
import type { SlashCommand } from "@/bindings/SlashCommand";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { highlightParts } from "./slashHighlight";
import { t } from "@/i18n";

export interface SlashMenuProps {
  /** Already filtered and ranked by parent (max ~50). */
  commands: SlashCommand[];
  /** Text typed after "/" (used for highlighting). */
  query: string;
  /** Highlighted row index; parent handles keyboard navigation. */
  activeIndex: number;
  /** First fetch in progress. */
  loading: boolean;
  /** Display label of the current provider ("Claude Code", "Codex", "Antigravity"). */
  providerLabel: string;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

interface NameSegment {
  text: string;
  match: boolean;
  muted: boolean;
}

const SKELETON_ROWS = [0, 1, 2] as const;

/** Compute highlight parts across the full name, then split at the last ":" boundary. */
function buildNameSegments(name: string, query: string): NameSegment[] {
  const parts = highlightParts(name, query);
  const lastColon = name.lastIndexOf(":");
  const splitAt = lastColon === -1 ? 0 : lastColon + 1;

  const segments: NameSegment[] = [];
  let offset = 0;

  for (const part of parts) {
    const start = offset;
    const end = offset + part.text.length;
    offset = end;

    if (splitAt > start && splitAt < end) {
      const cut = splitAt - start;
      segments.push({ text: part.text.slice(0, cut), match: part.match, muted: true });
      segments.push({ text: part.text.slice(cut), match: part.match, muted: false });
    } else {
      segments.push({ text: part.text, match: part.match, muted: end <= splitAt });
    }
  }

  return segments;
}

interface SlashMenuRowProps {
  command: SlashCommand;
  index: number;
  active: boolean;
  query: string;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

const SlashMenuRow = memo(function SlashMenuRow({
  command,
  index,
  active,
  query,
  onPick,
  onHover,
}: SlashMenuRowProps) {
  const segments = useMemo(() => buildNameSegments(command.name, query), [command.name, query]);
  const hasDescription = command.description.trim().length > 0;

  return (
    <li
      role="option"
      id={`slash-option-${index}`}
      aria-selected={active}
      data-index={index}
      className={cn(
        "cursor-pointer rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-150",
        active && "bg-accent text-accent-foreground",
      )}
      onMouseEnter={() => {
        if (!active) onHover(index);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(command);
      }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="max-w-full shrink-0 truncate font-mono text-[13px]">
          <span className="text-muted-foreground">/</span>
          {segments.map((seg, i) => (
            <span
              key={i}
              className={
                seg.match
                  ? "font-semibold text-hl"
                  : seg.muted
                    ? "text-muted-foreground"
                    : "text-foreground"
              }
            >
              {seg.text}
            </span>
          ))}
        </span>
        {command.argumentHint && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {command.argumentHint}
          </span>
        )}
      </div>
      {hasDescription && (
        <div className="truncate text-xs text-muted-foreground" title={command.description}>
          {command.description}
        </div>
      )}
    </li>
  );
});

export const SlashMenu = memo(function SlashMenu({
  commands,
  query,
  activeIndex,
  loading,
  providerLabel,
  onPick,
  onHover,
}: SlashMenuProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, commands]);

  const showSkeleton = loading && commands.length === 0;
  const showEmpty = !loading && commands.length === 0;

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg duration-150">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{t("chat.commandsFor", { provider: providerLabel })}</span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑↓</Kbd>
            <span className="hidden sm:inline">{t("chat.slashNavigate")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Tab</Kbd>
            <span className="hidden sm:inline">{t("chat.slashInsert")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>{t("chat.kbdEscape")}</Kbd>
            <span className="hidden sm:inline">{t("chat.slashClose")}</span>
          </span>
        </div>
      </div>

      {showSkeleton ? (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={t("chat.slashCommands")}
          id="slash-menu-listbox"
          aria-busy="true"
          className="max-h-[320px] overflow-y-auto p-1"
        >
          {SKELETON_ROWS.map((row) => (
            <li key={row} aria-hidden="true" className="space-y-1.5 px-2.5 py-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-56" />
            </li>
          ))}
        </ul>
      ) : showEmpty ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          {query.trim().length === 0
            ? t("chat.noCommandsFor", { provider: providerLabel })
            : t("chat.noMatchingCommand")}
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={t("chat.slashCommands")}
          id="slash-menu-listbox"
          className="max-h-[320px] overflow-y-auto p-1"
        >
          {commands.map((command, index) => (
            <SlashMenuRow
              key={command.name}
              command={command}
              index={index}
              active={index === activeIndex}
              query={query}
              onPick={onPick}
              onHover={onHover}
            />
          ))}
        </ul>
      )}
    </div>
  );
});
