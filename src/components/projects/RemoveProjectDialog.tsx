import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { useNav } from "@/stores/nav";
import { useProjectRemoval } from "@/stores/projectRemoval";

/** Confirmation of a project removal (asked through `useProjectRemoval`). Mounted once in AppShell. */
export function RemoveProjectDialog() {
  const target = useProjectRemoval((s) => s.target);
  const pending = useProjectRemoval((s) => s.pending);
  const projectName = useNav((s) => (target ? s.projects.find((p) => p.id === target)?.name : undefined));
  const label = projectName || t("shell.project");

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) useProjectRemoval.getState().cancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shell.removeProjectTitle")}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {t("shell.removeProjectDescription", { name: label })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => useProjectRemoval.getState().cancel()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void useProjectRemoval.getState().confirm()}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            <span>{t("common.remove")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
