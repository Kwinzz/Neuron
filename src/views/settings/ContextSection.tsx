import { Brain, Info, Layers } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useUi } from "@/stores/ui";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { useSettingsPatch } from "./useSettingsPatch";

interface ContextSectionProps {
  settings: AppSettings;
}

export function ContextSection({ settings }: ContextSectionProps) {
  const patch = useSettingsPatch();
  const context = settings.context;

  const handleToggle = (
    key: "injectMemory" | "gitSnapshot" | "recentFiles",
    value: boolean,
  ) => {
    void patch((current) => ({
      ...current,
      context: { ...current.context, [key]: value },
    }));
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Contexte injecté</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Éléments transmis automatiquement au démarrage d&apos;un nouveau chat.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-3.5">
          <SettingRow
            id="ctx-memory"
            label="Mémoire globale"
            description="Tes préférences et règles enregistrées dans memory.md"
            control={
              <SettingSwitch
                id="ctx-memory"
                checked={context.injectMemory}
                onCheckedChange={(checked) => handleToggle("injectMemory", checked)}
                aria-describedby="ctx-memory-desc"
              />
            }
          />
          <SettingRow
            id="ctx-git"
            label="Instantané git"
            description="Branche, statut et derniers commits du projet"
            control={
              <SettingSwitch
                id="ctx-git"
                checked={context.gitSnapshot}
                onCheckedChange={(checked) => handleToggle("gitSnapshot", checked)}
                aria-describedby="ctx-git-desc"
              />
            }
          />
          <SettingRow
            id="ctx-recent-files"
            label="Fichiers récents"
            description="Fichiers du projet modifiés récemment"
            control={
              <SettingSwitch
                id="ctx-recent-files"
                checked={context.recentFiles}
                onCheckedChange={(checked) => handleToggle("recentFiles", checked)}
                aria-describedby="ctx-recent-files-desc"
              />
            }
          />
        </div>

        <Separator />

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              S&apos;applique aux nouveaux chats uniquement : le contexte est figé à la
              création du chat.
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => useUi.getState().navigate({ kind: "memory" })}
          >
            <Brain className="size-3.5" aria-hidden />
            <span>Ouvrir la mémoire</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
