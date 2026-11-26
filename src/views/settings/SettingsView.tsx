import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ipcErrorMessage } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/toast";
import { useUi, type SettingsSection } from "@/stores/ui";
import { AgentsSection } from "./AgentsSection";
import { BackgroundSection } from "./BackgroundSection";
import { ContextSection } from "./ContextSection";
import { DevicesSection } from "./DevicesSection";
import { GeneralSection } from "./GeneralSection";
import { PricingCard } from "./PricingCard";
import { GenericClisSection } from "./GenericClisSection";
import { NotificationsSection } from "./NotificationsSection";
import { SettingsNav } from "./SettingsNav";
import { SettingsSkeleton } from "./SettingsSkeleton";
import { ShortcutsSection } from "./ShortcutsSection";
import { UpdatesSection } from "./UpdatesSection";
import { t } from "@/i18n";

interface SettingsViewProps {
  section?: SettingsSection;
}

export function SettingsView({ section }: SettingsViewProps) {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSettings = useCallback(() => {
    setLoadError(null);
    void useSettings
      .getState()
      .load()
      .catch((err: unknown) => {
        const message = ipcErrorMessage(err);
        setLoadError(message);
        toast({
          tone: "danger",
          title: t("settings.unavailable"),
          description: message,
        });
      });
  }, []);

  useEffect(() => {
    if (!useSettings.getState().loaded) {
      loadSettings();
    }
  }, [loadSettings]);

  const active: SettingsSection = section ?? "general";

  const handleSelectSection = useCallback((next: SettingsSection) => {
    useUi.getState().openSettings(next);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </header>

      <div className="grid min-w-0 gap-4 md:gap-6 min-[900px]:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav active={active} onSelect={handleSelectSection} />

        <div
          key={active}
          className="min-w-0 max-w-3xl animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
        >
          {active === "shortcuts" ? (
            <ShortcutsSection />
          ) : active === "agents" ? (
            <AgentsSection />
          ) : active === "devices" ? (
            <DevicesSection />
          ) : loadError !== null && settings === null ? (
            <Alert variant="destructive" className="has-data-[slot=alert-action]:pr-28">
              <AlertCircle aria-hidden />
              <AlertTitle>{t("settings.unavailable")}</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
              <AlertAction>
                <Button type="button" size="xs" variant="outline" onClick={loadSettings}>
                  {t("common.retry")}
                </Button>
              </AlertAction>
            </Alert>
          ) : !loaded || settings === null ? (
            <SettingsSkeleton />
          ) : active === "general" ? (
            <div className="flex flex-col gap-4">
              <GeneralSection settings={settings} />
              <PricingCard />
            </div>
          ) : active === "background" ? (
            <BackgroundSection settings={settings} />
          ) : active === "notifications" ? (
            <NotificationsSection settings={settings} />
          ) : active === "context" ? (
            <ContextSection settings={settings} />
          ) : active === "updates" ? (
            <UpdatesSection settings={settings} />
          ) : (
            <GenericClisSection settings={settings} />
          )}
        </div>
      </div>
    </div>
  );
}
