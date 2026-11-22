import { cn } from "cn";
import {
  Bell,
  Keyboard,
  Layers,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "@/stores/ui";

interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "context", label: "Contexte injecté", icon: Layers },
  { id: "generic", label: "CLI génériques", icon: SquareTerminal },
  { id: "shortcuts", label: "Raccourcis", icon: Keyboard },
];

interface SettingsNavProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  return (
    <nav
      aria-label="Sections des paramètres"
      className="min-w-0 min-[900px]:sticky min-[900px]:top-4 min-[900px]:self-start"
    >
      <ul className="flex gap-1 overflow-x-auto pb-1 min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:pb-0">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <li key={item.id} className="shrink-0 min-[900px]:w-full">
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
