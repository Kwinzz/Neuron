import { memo } from "react";
import { ClipboardList, Play } from "lucide-react";
import { cn } from "cn";

/** Fired by the composer on Maj+Tab: the visible mode switch toggles Plan. */
export const TOGGLE_PLAN_EVENT = "neuron:toggle-plan";

const OPTIONS = [
  { plan: false, label: "Exécuter", icon: Play, hint: "L'agent agit selon les permissions choisies" },
  { plan: true, label: "Planifier", icon: ClipboardList, hint: "Mode Plan : l'agent propose un plan sans rien modifier" },
] as const;

interface ModeSwitchProps {
  plan: boolean;
  onChange: (plan: boolean) => void;
  disabled?: boolean;
}

/** Exécuter ⇄ Planifier, next to the permissions menu (Maj+Tab from the message box). */
export const ModeSwitch = memo(function ModeSwitch({ plan, onChange, disabled }: ModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Mode de l'agent"
      className={cn("inline-flex h-7 items-center rounded-md bg-muted p-0.5", disabled && "opacity-50")}
    >
      {OPTIONS.map((o) => {
        const active = o.plan === plan;
        const Icon = o.icon;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={`${o.hint} (Maj+Tab)`}
            onClick={() => !active && onChange(o.plan)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
});
