import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Memory } from "@/bindings/Memory";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";

interface MemoryDeleteDialogProps {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemoryDeleteDialog({
  memory,
  open,
  onOpenChange,
}: MemoryDeleteDialogProps) {
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await useMemory.getState().remove(memory.id);
      toast({ tone: "ok", title: "Souvenir supprimé" });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible de supprimer le souvenir",
        description: ipcErrorMessage(err),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer ce souvenir ?</DialogTitle>
          <DialogDescription>
            Il sera retiré de memory.md et ne sera plus injecté dans les nouveaux chats.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap wrap-anywhere text-foreground">
          {memory.content}
        </div>

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
            onClick={() => void handleConfirm()}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            <span>Supprimer</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
