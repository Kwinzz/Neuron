import { memo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useChat } from "@/stores/chat";
import { useLive } from "@/stores/live";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

/**
 * Codex / Antigravity in Plan mode have no plan approval of their own: once the agent has answered, offer to
 * switch the chat to an executing mode and ask it to carry out the plan (the session resumes the conversation).
 */
export const PlanFollowUp = memo(function PlanFollowUp({ threadId }: { threadId: string }) {
  const [busy, setBusy] = useState(false);

  const run = async (permissionMode: string) => {
    const thread = useLive.getState().threads[threadId];
    if (!thread || busy) return;
    setBusy(true);
    try {
      const summary = await ipc.updateThreadSettings(threadId, { model: thread.model, effort: thread.effort, permissionMode });
      useLive.getState().hydrate([summary]);
      await useChat.getState().send(threadId, t("chat.runPlanPrompt"));
    } catch (err) {
      toast({ tone: "danger", title: t("chat.runPlanFailed"), description: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {t("chat.planModeHint")}
      </p>
      <Button size="sm" disabled={busy} onClick={() => void run("acceptEdits")}>
        {t("chat.runPlan")}
      </Button>
    </div>
  );
});
