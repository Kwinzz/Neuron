import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUi } from "@/stores/ui";
import { ShortcutsList } from "./ShortcutsList";

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);

  const handleOpenChange = (next: boolean) => {
    useUi.getState().setShortcutsOpen(next);
  };

  const handleOpenAllSettings = () => {
    useUi.getState().setShortcutsOpen(false);
    useUi.getState().openSettings("shortcuts");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
          <DialogDescription>Ctrl correspond à ⌘ sur macOS.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <ShortcutsList />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={handleOpenAllSettings}>
            <span>Tous les paramètres</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
