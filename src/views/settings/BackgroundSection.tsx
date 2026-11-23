import { useState, type KeyboardEvent } from "react";
import { AppWindow, Keyboard, RotateCcw } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { useSettingsPatch } from "./useSettingsPatch";

const DEFAULT_SHORTCUT = "Ctrl+Shift+Space";

/** Shortcut text → readable keys ("Ctrl+Shift+Space" → Ctrl · Maj · Espace). */
const KEY_LABEL: Record<string, string> = { Shift: "Maj", Space: "Espace", Alt: "Alt", Ctrl: "Ctrl", Super: "Win" };

function prettyKey(part: string): string {
  if (KEY_LABEL[part]) return KEY_LABEL[part];
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
      aria-label="Raccourci de la demande rapide"
      className="flex h-8 min-w-40 items-center justify-center gap-1 rounded-lg border bg-background px-2.5 text-sm transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {recording ? (
        <span className="text-muted-foreground animate-pulse">Appuie sur la combinaison…</span>
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
            <span>Arrière-plan</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Neuron reste dans la zone de notification (près de l&apos;horloge) : les agents continuent, les
            notifications arrivent et la demande rapide reste disponible.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <SettingRow
            id="bg-close-to-tray"
            label="Continuer en arrière-plan à la fermeture"
            description="La croix cache la fenêtre au lieu de quitter. « Quitter Neuron » dans le menu de l'icône arrête tout."
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
            label="Lancer avec Windows"
            description="Démarre Neuron discrètement dans la zone de notification à l'ouverture de session."
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
            <span>Demande rapide</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Depuis n&apos;importe quelle app (même en jeu, en plein écran fenêtré), un raccourci ouvre une petite
            fenêtre pour écrire ta demande et l&apos;envoyer à un nouveau chat ou à un chat récent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <SettingRow
            id="quick-enabled"
            label="Activer la demande rapide"
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
            label="Raccourci global"
            description="Clique puis appuie sur la combinaison (avec Ctrl, Alt ou Win). Échap pour annuler."
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
                    aria-label="Raccourci par défaut"
                    title={`Par défaut : ${DEFAULT_SHORTCUT}`}
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
