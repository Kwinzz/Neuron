import { memo, useCallback } from "react";
import { deviceOfThread } from "@/lib/deviceRouting";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import type { ChatSettings } from "@/lib/models";
import { useLive } from "@/stores/live";
import { toast } from "@/stores/toast";
import { ChatSettingsBar } from "./ChatSettingsBar";
import { t } from "@/i18n";

/**
 * Settings of an existing chat. Changes apply to the next message: a running agent restarts and
 * resumes the conversation — except Claude Code's permission mode, switched live. The mode also follows the
 * agent (plan approved, EnterPlanMode) through `PermissionModeChanged`. The provider (CLI) is locked.
 */
export const ThreadSettingsBar = memo(function ThreadSettingsBar({ threadId }: { threadId: string }) {
  const agent = useLive((s) => s.threads[threadId]?.agent ?? "claude_code");
  const model = useLive((s) => s.threads[threadId]?.model ?? null);
  const effort = useLive((s) => s.threads[threadId]?.effort ?? null);
  const permissionMode = useLive((s) => s.threads[threadId]?.permissionMode ?? "manual");
  const known = useLive((s) => threadId in s.threads);
  const device = deviceOfThread(threadId);

  const onChange = useCallback(
    (next: ChatSettings) => {
      ipc
        .updateThreadSettings(threadId, { model: next.model, effort: next.effort, permissionMode: next.permissionMode })
        .then((summary) => useLive.getState().hydrate([summary]))
        .catch((err: unknown) =>
          toast({ tone: "danger", title: t("chat.settingNotApplied"), description: ipcErrorMessage(err) }),
        );
    },
    [threadId],
  );

  return (
    <ChatSettingsBar
      key={threadId}
      value={{ agent, model, effort, permissionMode }}
      onChange={onChange}
      device={device}
      lockAgent
      disabled={!known}
    />
  );
});
