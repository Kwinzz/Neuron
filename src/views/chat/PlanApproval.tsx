import { memo, useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Button } from "@/components/ui/button";
import { permissionLabel } from "@/lib/models";
import { useChat } from "@/stores/chat";
import { t } from "@/i18n";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

/** How to run an approved plan: the mode the session switches to. */
const RUN_MODES = [
  { mode: "acceptEdits", label: "chat.runAcceptEdits", primary: true },
  { mode: "auto", label: "chat.runAuto", primary: false },
  { mode: "manual", label: "chat.runManual", primary: false },
] as const;

/**
 * Approval of a Claude plan (`ExitPlanMode` permission). Approving switches the session's mode and Claude
 * starts executing right away; « Continuer à planifier » keeps Plan mode (type the changes in the composer).
 */
export const PlanApproval = memo(function PlanApproval({ item, threadId }: { item: PermissionItem; threadId: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const pending = item.state === "pending" && chosen === null;

  useEffect(() => {
    if (!pending) return;
    const focused = document.activeElement;
    if ((focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && focused.value.trim() !== "") {
      return;
    }
    primaryRef.current?.focus({ preventScroll: true });
  }, [pending]);

  const respond = (allow: boolean, mode: string) => {
    if (!pending) return;
    setChosen(allow ? mode : "plan");
    void useChat.getState().respondPermission(threadId, item.id, allow, mode);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus());
  };

  if (!pending) {
    const approved = item.state === "allowed" || (chosen !== null && chosen !== "plan");
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        {approved ? <Check className="size-3.5 text-ok" /> : <Pencil className="size-3.5" />}
        {approved
          ? `${t("chat.planApproved")}${chosen && chosen !== "plan" ? t("chat.planRunningIn", { mode: permissionLabel(chosen).toLowerCase() }) : ""}`
          : t("chat.planContinued")}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("chat.planApproval")}
      className="flex flex-col gap-3 rounded-xl border border-live/30 bg-card px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          respond(false, "plan");
        }
      }}
    >
      <p className="text-sm text-foreground">{t("chat.runThisPlan")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {RUN_MODES.map((r) => (
          <Button
            key={r.mode}
            ref={r.primary ? primaryRef : undefined}
            size="sm"
            variant={r.primary ? "default" : "outline"}
            onClick={() => respond(true, r.mode)}
          >
            {t(r.label)}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => respond(false, "plan")}>
          {t("chat.keepPlanning")}
        </Button>
      </div>
    </div>
  );
});
