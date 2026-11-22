import { memo, useCallback } from "react";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import type { ChatSettings } from "@/lib/models";
import { useLive } from "@/stores/live";
import { toast } from "@/stores/toast";
import { ChatSettingsBar } from "./ChatSettingsBar";

/**
 * Settings of an existing chat. Changes apply to the next message: a running agent restarts and
 * resumes the conversation. The provider (CLI) is locked — another provider means a new chat.
 */
export const ThreadSettingsBar = memo(function ThreadSettingsBar({ threadId }: { threadId: string }) {
  const agent = useLive((s) => s.threads[threadId]?.agent ?? "claude_code");
  const model = useLive((s) => s.threads[threadId]?.model ?? null);
  const effort = useLive((s) => s.threads[threadId]?.effort ?? null);
  const permissionMode = useLive((s) => s.threads[threadId]?.permissionMode ?? "manual");
  const known = useLive((s) => threadId in s.threads);

  const onChange = useCallback(
    (next: ChatSettings) => {
      ipc
        .updateThreadSettings(threadId, { model: next.model, effort: next.effort, permissionMode: next.permissionMode })
        .then((summary) => useLive.getState().hydrate([summary]))
        .catch((err: unknown) =>
          toast({ tone: "danger", title: "Réglage non appliqué", description: ipcErrorMessage(err) }),
        );
    },
    [threadId],
  );

  return (
    <ChatSettingsBar
      value={{ agent, model, effort, permissionMode }}
      onChange={onChange}
      lockAgent
      disabled={!known}
    />
  );
});
