import { Keyboard } from "lucide-react";
import { ShortcutsList } from "@/components/shortcuts/ShortcutsList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ShortcutsSection() {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Raccourcis clavier</span>
        </CardTitle>
        <CardDescription className="text-xs">Ctrl correspond à ⌘ sur macOS.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <ShortcutsList />
      </CardContent>
    </Card>
  );
}
