import { memo } from "react";
import { Brain, Cpu, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CLAUDE_MODELS, type ChatSettings, DEFAULT, EFFORT_LEVELS, PERMISSION_MODES } from "@/lib/models";

interface ChatSettingsBarProps {
  value: ChatSettings;
  onChange: (next: ChatSettings) => void;
  disabled?: boolean;
}

const TRIGGER = "h-7 gap-1 border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-transparent";

/** Model · reasoning effort · permissions selectors (controlled). */
export const ChatSettingsBar = memo(function ChatSettingsBar({ value, onChange, disabled }: ChatSettingsBarProps) {
  const customModel = value.model !== null && !CLAUDE_MODELS.some((m) => m.id === value.model);
  return (
    <>
      <Select
        value={value.model ?? DEFAULT}
        onValueChange={(v) => onChange({ ...value, model: v === DEFAULT ? null : v })}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className={TRIGGER} aria-label="Modèle">
          <Cpu className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectLabel>Modèle</SelectLabel>
            <SelectItem value={DEFAULT}>Par défaut (Claude Code)</SelectItem>
            <SelectSeparator />
            {CLAUDE_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span>{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.hint}</span>
              </SelectItem>
            ))}
            {customModel && value.model && <SelectItem value={value.model}>{value.model}</SelectItem>}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        value={value.effort ?? DEFAULT}
        onValueChange={(v) => onChange({ ...value, effort: v === DEFAULT ? null : v })}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className={TRIGGER} aria-label="Niveau de raisonnement">
          <Brain className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectLabel>Raisonnement</SelectLabel>
            <SelectItem value={DEFAULT}>Par défaut</SelectItem>
            <SelectSeparator />
            {EFFORT_LEVELS.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        value={value.permissionMode}
        onValueChange={(v) => onChange({ ...value, permissionMode: v })}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className={`${TRIGGER} ${value.permissionMode === "bypassPermissions" ? "text-warn" : ""}`}
          aria-label="Permissions"
        >
          <ShieldCheck className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectLabel>Permissions</SelectLabel>
            {PERMISSION_MODES.map((p) => (
              <SelectItem key={p.id} value={p.id} title={p.hint}>
                {p.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
});
