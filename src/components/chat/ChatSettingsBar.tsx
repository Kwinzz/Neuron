import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ChatSettings, PERMISSION_MODES, permissionLabel } from "@/lib/models";
import { resolveModelId, useDeviceProviders } from "@/stores/models";
import { EffortPicker } from "./EffortPicker";
import { ModeSwitch, TOGGLE_PLAN_EVENT } from "./ModeSwitch";
import { ModelPicker } from "./ModelPicker";
import { t } from "@/i18n";

interface ChatSettingsBarProps {
  value: ChatSettings;
  onChange: (next: ChatSettings) => void;
  /** Remote device node id, or null for this PC. */
  device?: string | null;
  /** Existing chat: provider locked. */
  lockAgent?: boolean;
  disabled?: boolean;
}

const TRIGGER =
  "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground [&>svg:last-child]:transition-transform [&>svg:last-child]:duration-200 data-[state=open]:[&>svg:last-child]:rotate-180";
/** Plan is the mode switch's job; the permissions menu holds how the agent acts when it executes. */
const EXEC_MODES = PERMISSION_MODES.filter((p) => p.id !== "plan");

/** Model (all providers) · reasoning effort · permissions. Plain menus: no hover-scrolling lists. */
export const ChatSettingsBar = memo(function ChatSettingsBar({
  value,
  onChange,
  device = null,
  lockAgent,
  disabled,
}: ChatSettingsBarProps) {
  const providers = useDeviceProviders(device);
  const note = providers.find((p) => p.agent === value.agent)?.note;

  // Execution mode to come back to when leaving Plan (and shown by the permissions menu meanwhile).
  const plan = value.permissionMode === "plan";
  const [execMode, setExecMode] = useState(plan ? "manual" : value.permissionMode);
  useEffect(() => {
    if (value.permissionMode !== "plan") setExecMode(value.permissionMode);
  }, [value.permissionMode]);
  const shownMode = plan ? execMode : value.permissionMode;

  const togglePlan = (next: boolean) => onChange({ ...value, permissionMode: next ? "plan" : execMode });
  // Maj+Tab in the message box (latest props through a ref: the listener is registered once).
  const toggleRef = useRef(() => {});
  toggleRef.current = () => {
    if (!disabled && value.agent !== "generic") togglePlan(!plan);
  };
  useEffect(() => {
    const handler = () => toggleRef.current();
    window.addEventListener(TOGGLE_PLAN_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_PLAN_EVENT, handler);
  }, []);

  return (
    <>
      <ModelPicker
        agent={value.agent}
        model={value.model}
        device={device}
        lockAgent={lockAgent}
        disabled={disabled}
        onChange={(agent, next) => {
          if (!next) {
            onChange({ ...value, agent, model: null, effort: null });
            return;
          }
          // Keep the effort only if the new model supports it.
          const keep = value.effort && (next.efforts.length === 0 || next.efforts.includes(value.effort));
          const effort = keep ? value.effort : null;
          onChange({ ...value, agent, model: resolveModelId(next, effort), effort });
        }}
      />

      {/* Generic CLIs: no reasoning level nor permission prompts. */}
      {value.agent !== "generic" && (
        <>
          <EffortPicker
            agent={value.agent}
            model={value.model}
            effort={value.effort}
            device={device}
            className={TRIGGER}
            disabled={disabled}
            onChange={(effort, model) => onChange({ ...value, effort, model })}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(TRIGGER, shownMode === "bypassPermissions" && "text-warn hover:text-warn")}
                disabled={disabled}
                aria-label={t("chat.permissions")}
              >
                <ShieldCheck className="size-3.5" />
                {permissionLabel(shownMode)}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t("chat.permissions")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={shownMode}
                onValueChange={(v) => (plan ? setExecMode(v) : onChange({ ...value, permissionMode: v }))}
              >
                {EXEC_MODES.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} className="items-start py-1.5">
                    <div className="flex flex-col">
                      <span className={p.id === "bypassPermissions" ? "text-warn" : undefined}>{p.label}</span>
                      <span className="text-xs text-muted-foreground">{p.hint}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {plan && (
                <>
                  <DropdownMenuSeparator />
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("chat.planModeActiveNote")}
                  </p>
                </>
              )}
              {note && (
                <>
                  <DropdownMenuSeparator />
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{note}</p>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <ModeSwitch plan={plan} onChange={togglePlan} disabled={disabled} />
        </>
      )}
    </>
  );
});
