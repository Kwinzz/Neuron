import { memo } from "react";
import { ClipboardList, Play } from "lucide-react";
import { cn } from "cn";
import { t } from "@/i18n";

/** Fired by the composer on Maj+Tab: the visible mode switch toggles Plan. */
export const TOGGLE_PLAN_EVENT = "neuron:toggle-plan";

const OPTIONS = [
  { plan: false, label: "chat.modeRun", icon: Play, hint: "chat.modeRunHint" },
  { plan: true, label: "chat.modePlan", icon: ClipboardList, hint: "chat.modePlanHint" },
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
      aria-label={t("chat.agentMode")}
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
            title={t("chat.modeSwitchTitle", { hint: t(o.hint) })}
            onClick={() => !active && onChange(o.plan)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {t(o.label)}
          </button>
        );
      })}
    </div>
  );
});
