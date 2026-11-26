import { Brain, ChevronDown } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
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
import { t } from "@/i18n";
import { DEFAULT_EFFORTS, effortLabel } from "@/lib/models";
import { findModel, resolveModelId, useDeviceProviders } from "@/stores/models";

const DEFAULT = "default";

interface EffortPickerProps {
  agent: AgentKind;
  model: string | null;
  effort: string | null;
  /** New level, and the model id to use with it (Antigravity families: each level is its own model). */
  onChange: (effort: string | null, model: string | null) => void;
  /** Remote device node id, or null for this PC. */
  device?: string | null;
  className?: string;
  disabled?: boolean;
  /** Controlled opening (keyboard shortcut); uncontrolled when absent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called instead of giving the focus back to the trigger when the menu closes. */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Reasoning level of the chosen model (« Par défaut » + the levels it accepts). */
export function EffortPicker({
  agent,
  model: modelId,
  effort,
  onChange,
  device = null,
  className,
  disabled,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: EffortPickerProps) {
  const providers = useDeviceProviders(device);
  const model = findModel(providers, agent, modelId);
  const efforts = model && model.efforts.length > 0 ? model.efforts : [...DEFAULT_EFFORTS];
  // Families (Antigravity): the level actually used is the one of the selected variant.
  const family = model?.effortModels ?? null;
  const variantLevel = family ? Object.entries(family).find(([, id]) => id === modelId)?.[0] : undefined;
  const shown = variantLevel ?? effort;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          disabled={disabled}
          aria-label={t("chat.reasoningLevel")}
        >
          <Brain className="size-3.5" />
          {effortLabel(shown)}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("chat.reasoning")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shown ?? DEFAULT}
          onValueChange={(v) => {
            const next = v === DEFAULT ? null : v;
            // Families (Antigravity): the level is a different model id.
            onChange(next, model?.effortModels ? resolveModelId(model, next) : modelId);
          }}
        >
          {/* Families: every level is a concrete model, so there is no separate "default". */}
          {!family && (
            <>
              <DropdownMenuRadioItem value={DEFAULT}>
                {t("chat.byDefault")}
                {model?.defaultEffort ? ` (${effortLabel(model.defaultEffort)})` : ""}
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
  );
}
