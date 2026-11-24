import { useCallback, useEffect, useMemo, useState } from "react";
import { DraftContextPreview } from "@/components/context/DraftContextPreview";
import type { Attachment } from "@/bindings/Attachment";
import { FolderGit2, FolderOpen, MessageSquarePlus } from "lucide-react";
import { AgentAccessNotice } from "@/components/chat/AgentAccessNotice";
import { ChatSettingsBar } from "@/components/chat/ChatSettingsBar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { readChatDefaults, saveChatDefaults } from "@/lib/chatDefaults";
import type { ChatSettings } from "@/lib/models";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import { Composer } from "./Composer";
import { t } from "@/i18n";


function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Empty chat: pick model / reasoning / permissions, type, and the chat is created on send. */
export function DraftChat({ projectId }: { projectId: string | null }) {
  const project = useNav((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const [settings, setSettings] = useState<ChatSettings>(readChatDefaults);
  const [cwd, setCwd] = useState<string>("");

  useEffect(() => {
    if (projectId) return;
    ipc
      .defaultCwd()
      .then((dir) => setCwd((current) => current || dir))
      .catch(() => undefined);
  }, [projectId]);

  const onSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    saveChatDefaults(next);
  }, []);

  const browse = useCallback(async () => {
    try {
      const picked = await ipc.pickDirectory(cwd || undefined);
      if (picked) setCwd(picked);
    } catch (err) {
      toast({ tone: "danger", title: t("chat.folderUnavailable"), description: ipcErrorMessage(err) });
    }
  }, [cwd]);

  const submit = useCallback(
    async (text: string, attachments: Attachment[]) => {
      try {
        const chat = await ipc.createThread({
          agent: settings.agent,
          cwd: projectId ? null : cwd || null,
          model: settings.model,
          effort: settings.effort,
          permissionMode: settings.permissionMode,
          title: null,
          projectId,
          prompt: text,
          attachments,
        });
        useLive.getState().hydrate([chat]);
        useUi.getState().focusThread(chat.id);
        void useNav.getState().load();
        useDashboard.getState().scheduleRefresh();
        return true;
      } catch (err) {
        toast({ tone: "danger", title: t("chat.startChatFailed"), description: ipcErrorMessage(err) });
        return false;
      }
    },
    [cwd, projectId, settings],
  );

  const toolbar = useMemo(
    () => (
      <>
        <ChatSettingsBar value={settings} onChange={onSettings} />
        {!projectId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-48 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => void browse()}
              >
                <FolderOpen className="size-3.5" />
                <span className="truncate">{cwd ? folderName(cwd) : t("chat.folderButton")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="font-mono">{cwd || t("chat.pickWorkDir")}</TooltipContent>
          </Tooltip>
        )}
      </>
    ),
    [browse, cwd, onSettings, projectId, settings],
  );

  return (
    <div className="flex min-h-full flex-col px-4 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border bg-card animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy">
          <MessageSquarePlus className="size-5 text-muted-foreground" />
        </div>
        <h2
          className="text-2xl font-semibold tracking-tight animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
          style={{ animationDelay: "40ms" }}
        >
          {t("chat.newChat")}
        </h2>
        <p
          className="max-w-md text-sm text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
          style={{ animationDelay: "80ms" }}
        >
          {project ? (
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2 className="size-4" />
              {t("chat.inProject")} <span className="font-medium text-foreground">{project.name}</span>
            </span>
          ) : (
            t("chat.draftHint")
          )}
        </p>
        {projectId && <DraftContextPreview projectId={projectId} />}
      </div>
      <AgentAccessNotice agent={settings.agent} />
      <Composer
        threadId={null}
        projectId={projectId}
        slashAgent={settings.agent}
        slashCwd={project ? project.path : cwd || null}
        submit={submit}
        toolbar={toolbar}
        placeholder={t("chat.draftPlaceholder")}
        active={false}
        onSent={noop}
        showPill={false}
        onPillClick={noop}
      />
    </div>
  );
}

function noop() {}
