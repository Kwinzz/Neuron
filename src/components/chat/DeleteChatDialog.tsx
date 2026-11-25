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
import { useChatDeletion } from "@/stores/chatDeletion";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { t } from "@/i18n";

/** Confirmation of a chat deletion (asked through `useChatDeletion`). Mounted once in AppShell. */
export function DeleteChatDialog() {
  const target = useChatDeletion((s) => s.target);
  const pending = useChatDeletion((s) => s.pending);
  const title = useLive((s) => (target ? s.threads[target]?.title : undefined));
  const navTitle = useNav((s) => (target ? s.chats.find((c) => c.id === target)?.title : undefined));
  const label = title || navTitle || t("common.untitledChat");

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) useChatDeletion.getState().cancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("chat.deleteChatTitle")}</DialogTitle>
          <DialogDescription className="wrap-anywhere">{t("chat.deleteChatDescription", { title: label })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => useChatDeletion.getState().cancel()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void useChatDeletion.getState().confirm()}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            <span>{t("common.delete")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
