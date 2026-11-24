import { cn } from "cn";
import { Kbd } from "@/components/ui/Kbd";
import { SHORTCUTS, comboKeys, shortcutGroupLabel, type Shortcut } from "@/lib/shortcuts";

const GROUP_ORDER: readonly Shortcut["group"][] = ["navigation", "window", "chat"];

const GROUPED_SHORTCUTS: ReadonlyArray<{
  group: Shortcut["group"];
  items: readonly Shortcut[];
}> = GROUP_ORDER.map((group) => ({
  group,
  items: SHORTCUTS.filter((shortcut) => shortcut.group === group),
}));

interface ShortcutsListProps {
  className?: string;
}

export function ShortcutsList({ className }: ShortcutsListProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)}>
      {GROUPED_SHORTCUTS.map(({ group, items }) => (
        <section key={group} aria-label={shortcutGroupLabel(group)} className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{shortcutGroupLabel(group)}</h3>
          <ul className="divide-y divide-border">
            {items.map((shortcut) => {
              const keys = comboKeys(shortcut.combo);
              return (
                <li
                  key={shortcut.id}
                  className="flex min-w-0 items-center justify-between gap-4 py-1.5 text-sm"
                >
                  <span className="min-w-0 text-foreground">{shortcut.label}</span>
                  <span
                    role="group"
                    aria-label={keys.join(" + ")}
                    className="flex shrink-0 items-center gap-1"
                  >
                    {keys.map((key, index) => (
                      <Kbd key={`${shortcut.id}-${index}`}>{key}</Kbd>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
