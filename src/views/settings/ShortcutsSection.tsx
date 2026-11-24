import { Keyboard } from "lucide-react";
import { ShortcutsList } from "@/components/shortcuts/ShortcutsList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { t } from "@/i18n";

export function ShortcutsSection() {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("settings.shortcutsTitle")}</span>
        </CardTitle>
        <CardDescription className="text-xs">{t("settings.shortcutsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <ShortcutsList />
      </CardContent>
    </Card>
  );
}
