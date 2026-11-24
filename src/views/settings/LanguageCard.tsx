import { Languages } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLang, setLang, t, type Lang } from "@/i18n";
import { SettingRow } from "./SettingRow";
import { useSettingsPatch } from "./useSettingsPatch";

/** Each language is always named in itself, whatever the current interface language. */
const LANGUAGES: ReadonlyArray<{ value: Lang; label: string }> = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

function isLang(value: string): value is Lang {
  return value === "fr" || value === "en";
}

interface LanguageCardProps {
  settings: AppSettings;
}

/** Interface language: saved in the settings, then the app remounts in the new language. */
export function LanguageCard({ settings }: LanguageCardProps) {
  const patch = useSettingsPatch();
  const current: Lang = settings.language ?? getLang();

  const handleChange = async (next: string) => {
    if (!isLang(next) || next === current) return;
    const ok = await patch((s) => ({ ...s, language: next }));
    if (ok) setLang(next);
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardContent>
        <SettingRow
          id="settings-language"
          label={t("settings.language")}
          description={t("settings.languageDescription")}
          control={
            <Select value={current} onValueChange={(next) => void handleChange(next)}>
              <SelectTrigger
                id="settings-language"
                size="sm"
                aria-describedby="settings-language-desc"
                className="min-w-32"
              >
                <Languages className="text-muted-foreground" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value} lang={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </CardContent>
    </Card>
  );
}
