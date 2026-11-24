import { memo, useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, ShieldCheck } from "lucide-react";
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
import { type ChatSettings, DEFAULT_EFFORTS, PERMISSION_MODES, effortLabel, permissionLabel } from "@/lib/models";
import { findModel, resolveModelId, useModels } from "@/stores/models";
import { ModeSwitch, TOGGLE_PLAN_EVENT } from "./ModeSwitch";
import { ModelPicker } from "./ModelPicker";
import { t } from "@/i18n";

interface ChatSettingsBarProps {
  value: ChatSettings;
  onChange: (next: ChatSettings) => void;
  /** Existing chat: provider locked. */
  lockAgent?: boolean;
  disabled?: boolean;
}

const TRIGGER =
  "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground [&>svg:last-child]:transition-transform [&>svg:last-child]:duration-200 data-[state=open]:[&>svg:last-child]:rotate-180";
const DEFAULT = "default";
/** Plan is the mode switch's job; the permissions menu holds how the agent acts when it executes. */
const EXEC_MODES = PERMISSION_MODES.filter((p) => p.id !== "plan");

/** Model (all providers) · reasoning effort · permissions. Plain menus: no hover-scrolling lists. */
export const ChatSettingsBar = memo(function ChatSettingsBar({
  value,
  onChange,
  lockAgent,
  disabled,
}: ChatSettingsBarProps) {
  const providers = useModels((s) => s.providers);
  const model = findModel(providers, value.agent, value.model);
  const efforts = model && model.efforts.length > 0 ? model.efforts : [...DEFAULT_EFFORTS];
  const note = providers.find((p) => p.agent === value.agent)?.note;
  // Families (Antigravity): the level actually used is the one of the selected variant.
  const family = model?.effortModels ?? null;
  const variantLevel = family ? Object.entries(family).find(([, id]) => id === value.model)?.[0] : undefined;
  const shownEffort = variantLevel ?? value.effort;

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={TRIGGER}
                disabled={disabled}
                aria-label={t("chat.reasoningLevel")}
              >
                <Brain className="size-3.5" />
                {effortLabel(shownEffort)}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t("chat.reasoning")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={shownEffort ?? DEFAULT}
                onValueChange={(v) => {
                  const effort = v === DEFAULT ? null : v;
                  // Families (Antigravity): the level is a different model id.
                  const nextModel = model?.effortModels ? resolveModelId(model, effort) : value.model;
                  onChange({ ...value, effort, model: nextModel });
                }}
              >
                {/* Families: every level is a concrete model, so there is no separate "default". */}
                {!family && (
                  <>
                    <DropdownMenuRadioItem value={DEFAULT}>
                      {t("chat.byDefault")}{model?.defaultEffort ? ` (${effortLabel(model.defaultEffort)})` : ""}
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {efforts.map((e) => (
                  <DropdownMenuRadioItem key={e} value={e}>
                    {effortLabel(e)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(TRIGGER, shownMode === "bypassPermissions" && "text-warn hover:text-warn")}
                disabled={disabled}
                aria-label="Permissions"
              >
                <ShieldCheck className="size-3.5" />
                {permissionLabel(shownMode)}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Permissions</DropdownMenuLabel>
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
