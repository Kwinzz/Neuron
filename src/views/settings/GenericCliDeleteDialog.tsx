import { Loader2 } from "lucide-react";
import type { GenericCliProfile } from "@/bindings/GenericCliProfile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GenericCliCommandPreview } from "./GenericCliCommandPreview";

interface GenericCliDeleteDialogProps {
  profile: GenericCliProfile | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function GenericCliDeleteDialog({
  profile,
  pending,
  onOpenChange,
  onConfirm,
}: GenericCliDeleteDialogProps) {
  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer ce CLI ?</DialogTitle>
          <DialogDescription>
            Les chats existants qui l&apos;utilisent ne pourront plus envoyer de message.
          </DialogDescription>
        </DialogHeader>

        {profile && (
          <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted/30 p-3">
            <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
            <GenericCliCommandPreview command={profile.command} args={profile.args} />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            <span>Supprimer</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
