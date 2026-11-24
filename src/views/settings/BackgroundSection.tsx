import { IS_LINUX, IS_WINDOWS } from "@/lib/platform";
import { useState, type KeyboardEvent } from "react";
import { AppWindow, Keyboard, RotateCcw } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { useSettingsPatch } from "./useSettingsPatch";
import { t } from "@/i18n";

const DEFAULT_SHORTCUT = "Ctrl+Shift+Space";

/** Shortcut text → readable keys ("Ctrl+Shift+Space" → Ctrl · Maj · Espace). */
function keyLabel(part: string): string | undefined {
  switch (part) {
    case "Shift":
      return t("settings.keyShift");
    case "Space":
      return t("settings.keySpace");
    case "Alt":
      return "Alt";
    case "Ctrl":
      return "Ctrl";
    case "Super":
      return "Win";
    default:
      return undefined;
  }
}

function prettyKey(part: string): string {
  const label = keyLabel(part);
  if (label) return label;
  if (/^Key[A-Z]$/.test(part)) return part.slice(3);
  if (/^Digit\d$/.test(part)) return part.slice(5);
  return part;
}

/** A keydown → global-shortcut string (modifiers + `KeyboardEvent.code`), or null while only modifiers are held. */
function shortcutFrom(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return [...mods, e.code].join("+");
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [recording, setRecording] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      return;
    }
    const next = shortcutFrom(e);
    if (!next) return;
    // A global shortcut without Ctrl / Alt / Win would swallow that key everywhere (games included).
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d+$/.test(e.code)) return;
    setRecording(false);
    onChange(next);
  };

  return (
    <button
      type="button"
      onClick={() => setRecording((r) => !r)}
      onKeyDown={onKeyDown}
      onBlur={() => setRecording(false)}
      aria-label={t("settings.shortcutAria")}
      className="flex h-8 min-w-40 items-center justify-center gap-1 rounded-lg border bg-background px-2.5 text-sm transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {recording ? (
        <span className="text-muted-foreground animate-pulse">{t("settings.shortcutRecording")}</span>
      ) : (
        value.split("+").map((part) => (
          <kbd key={part} className="rounded border bg-muted px-1.5 font-mono text-[11px] font-medium">
            {prettyKey(part)}
          </kbd>
        ))
      )}
    </button>
  );
}

/** Background mode (tray, start with Windows) and the system-wide quick prompt shortcut. */
export function BackgroundSection({ settings }: { settings: AppSettings }) {
  const patch = useSettingsPatch();
  const { background, quickLauncher } = settings;

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AppWindow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("settings.bgTitle")}</span>
          </CardTitle>
          <CardDescription className="text-xs">
            {t("settings.bgDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <SettingRow
            id="bg-close-to-tray"
            label={t("settings.closeToTray")}
            description={t("settings.closeToTrayDescription")}
            control={
              <SettingSwitch
                id="bg-close-to-tray"
                checked={background.closeToTray}
                onCheckedChange={(closeToTray) =>
                  void patch((s) => ({ ...s, background: { ...s.background, closeToTray } }))
                }
                aria-describedby="bg-close-to-tray-desc"
              />
            }
          />
          <Separator />
          <SettingRow
            id="bg-autostart"
            label={IS_WINDOWS ? t("settings.launchWithWindows") : t("settings.launchAtLogin")}
            description={
              import.meta.env.DEV
                ? t("settings.launchDescriptionDev")
                : t("settings.launchDescription")
            }
            control={
              <SettingSwitch
                id="bg-autostart"
                checked={background.launchAtLogin}
                onCheckedChange={(launchAtLogin) =>
                  void patch((s) => ({ ...s, background: { ...s.background, launchAtLogin } }))
                }
                aria-describedby="bg-autostart-desc"
              />
            }
          />
        </CardContent>
      </Card>

      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("settings.quickTitle")}</span>
          </CardTitle>
          <CardDescription className="text-xs">
            {t("settings.quickDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <SettingRow
            id="quick-enabled"
            label={t("settings.quickEnable")}
            control={
              <SettingSwitch
                id="quick-enabled"
                checked={quickLauncher.enabled}
                onCheckedChange={(enabled) =>
                  void patch((s) => ({ ...s, quickLauncher: { ...s.quickLauncher, enabled } }))
                }
              />
            }
          />
          <Separator />
          <SettingRow
            id="quick-shortcut"
            label={t("settings.quickShortcut")}
            description={
              IS_LINUX
                ? t("settings.quickShortcutLinux")
                : t("settings.quickShortcutHint")
            }
            disabled={!quickLauncher.enabled}
            control={
              <div className="flex items-center gap-1">
                <ShortcutRecorder
                  value={quickLauncher.shortcut}
                  onChange={(shortcut) =>
                    void patch((s) => ({ ...s, quickLauncher: { ...s.quickLauncher, shortcut } }))
                  }
                />
                {quickLauncher.shortcut !== DEFAULT_SHORTCUT && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("settings.shortcutReset")}
                    title={t("settings.shortcutDefault", { shortcut: DEFAULT_SHORTCUT })}
                    onClick={() =>
                      void patch((s) => ({ ...s, quickLauncher: { ...s.quickLauncher, shortcut: DEFAULT_SHORTCUT } }))
                    }
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
