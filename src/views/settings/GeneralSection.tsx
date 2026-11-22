import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "cn";
import { Timer } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsPatch } from "./useSettingsPatch";

const MAX_IDLE_MINUTES = 1440;

const PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Jamais" },
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
];

const PRESET_VALUES = new Set(PRESETS.map((preset) => preset.value));

interface GeneralSectionProps {
  settings: AppSettings;
}

export function GeneralSection({ settings }: GeneralSectionProps) {
  const patch = useSettingsPatch();
  const minutes = settings.idleShutdownMinutes;
  const isPreset = PRESET_VALUES.has(minutes);

  const [customDraft, setCustomDraft] = useState(() => (isPreset ? "" : String(minutes)));
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setCustomDraft(PRESET_VALUES.has(minutes) ? "" : String(minutes));
  }, [minutes]);

  const selectMinutes = (value: number) => {
    if (value === minutes) return;
    void patch((current) => ({ ...current, idleShutdownMinutes: value }));
  };

  const commitCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) {
      setCustomDraft(isPreset ? "" : String(minutes));
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      setCustomDraft(isPreset ? "" : String(minutes));
      return;
    }
    const clamped = Math.min(MAX_IDLE_MINUTES, Math.max(0, Math.trunc(parsed)));
    setCustomDraft(PRESET_VALUES.has(clamped) ? "" : String(clamped));
    if (clamped !== minutes) {
      void patch((current) => ({ ...current, idleShutdownMinutes: clamped }));
    }
  };

  const handleRadioKeyDown = (index: number, e: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (index + 1) % PRESETS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (index - 1 + PRESETS.length) % PRESETS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = PRESETS.length - 1;
    }
    if (nextIndex === null) return;

    const nextPreset = PRESETS[nextIndex];
    if (!nextPreset) return;

    e.preventDefault();
    radioRefs.current[nextIndex]?.focus();
    selectMinutes(nextPreset.value);
  };

  const activePresetIndex = PRESETS.findIndex((preset) => preset.value === minutes);
  const focusableIndex = activePresetIndex >= 0 ? activePresetIndex : 0;

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Arrêt des agents inactifs</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Les processus inactifs sont arrêtés pour libérer la mémoire ; le chat reprend
          automatiquement au message suivant.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div
            role="radiogroup"
            aria-label="Délai avant arrêt des agents inactifs"
            className="inline-flex flex-wrap items-center rounded-lg border bg-muted/40 p-0.5"
          >
            {PRESETS.map((preset, index) => {
              const checked = preset.value === minutes;
              return (
                <button
                  key={preset.value}
                  ref={(el) => {
                    radioRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={index === focusableIndex ? 0 : -1}
                  onClick={() => selectMinutes(preset.value)}
                  onKeyDown={(e) => handleRadioKeyDown(index, e)}
                  className={cn(
                    "h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium tabular-nums transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    checked
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="idle-custom-minutes" className="text-xs text-muted-foreground">
              Personnalisé
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="idle-custom-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_IDLE_MINUTES}
                step={1}
                value={customDraft}
                placeholder={String(minutes)}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={commitCustom}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  } else if (e.key === "Escape") {
                    setCustomDraft(isPreset ? "" : String(minutes));
                    e.currentTarget.blur();
                  }
                }}
                className="w-24 font-mono tabular-nums"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {minutes === 0 ? (
            "Les agents restent actifs tant que Neuron est ouvert."
          ) : (
            <>
              Arrêt après{" "}
              <span className="font-mono tabular-nums text-foreground">{minutes}</span> min
              d&apos;inactivité.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
