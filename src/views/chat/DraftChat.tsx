import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DraftContextPreview } from "@/components/context/DraftContextPreview";
import type { Attachment } from "@/bindings/Attachment";
import { FolderGit2, FolderOpen, MessageSquarePlus } from "lucide-react";
import { AgentAccessNotice } from "@/components/chat/AgentAccessNotice";
import { ChatSettingsBar } from "@/components/chat/ChatSettingsBar";
import { DevicePicker } from "@/components/chat/DevicePicker";
import { Button } from "@/components/ui/button";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deviceOfProject } from "@/lib/deviceRouting";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { readChatDefaults, saveChatDefaults } from "@/lib/chatDefaults";
import type { ChatSettings } from "@/lib/models";
import { useDashboard } from "@/stores/dashboard";
import { useDevices } from "@/stores/devices";
import { useLive } from "@/stores/live";
import { findModel, useDeviceProviders, useModels } from "@/stores/models";
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
  const projectDevice = deviceOfProject(projectId);
  const [pickedDevice, setPickedDevice] = useState<string | null>(null);
  const device = projectId ? projectDevice : pickedDevice;
  const deviceName = useDevices((s) =>
    device ? s.devices?.hosts.find((h) => h.nodeId === device)?.name : undefined,
  );
  const [settings, setSettings] = useState<ChatSettings>(readChatDefaults);
  const [cwd, setCwd] = useState<string>("");
  const manualCwdRef = useRef(false);

  // When switching to another device, fall back to its default model if the chosen one does not exist there.
  const deviceProviders = useDeviceProviders(device);
  const providersLoaded = useModels((s) => (device ? Boolean(s.remoteLoaded[device]) : s.loaded));
  const lastCheckedDeviceRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastCheckedDeviceRef.current === device) return;
    if (!providersLoaded) return;
    lastCheckedDeviceRef.current = device;
    if (deviceProviders.length === 0) return;
    setSettings((cur) => {
      if (cur.model === null) return cur;
      if (findModel(deviceProviders, cur.agent, cur.model)) return cur;
      return { ...cur, model: null, effort: null };
    });
  }, [device, deviceProviders, providersLoaded]);

  useEffect(() => {
    if (projectId) return;
    let cancelled = false;
    manualCwdRef.current = false;
    setCwd("");
    ipc
      .defaultCwd(device)
      .then((dir) => {
        if (!cancelled && !manualCwdRef.current) setCwd(dir);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, device]);

  const onSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    saveChatDefaults(next);
  }, []);

  const browse = useCallback(async () => {
    try {
      const picked = await ipc.pickDirectory(cwd || undefined);
      if (picked) {
        manualCwdRef.current = true;
        setCwd(picked);
      }
    } catch (err) {
      toast({ tone: "danger", title: t("chat.folderUnavailable"), description: ipcErrorMessage(err) });
    }
  }, [cwd]);

  const submit = useCallback(
    async (text: string, attachments: Attachment[]) => {
      try {
        const chat = await ipc.createThread(
          {
            agent: settings.agent,
            cwd: projectId || device ? null : cwd || null,
            model: settings.model,
            effort: settings.effort,
            permissionMode: settings.permissionMode,
            title: null,
            projectId,
            prompt: text,
            attachments,
          },
          device,
        );
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
    [cwd, device, projectId, settings],
  );

  const remoteName = deviceName ?? t("shell.unknownDevice");

  const toolbar = useMemo(
    () => (
      <>
        <ChatSettingsBar value={settings} onChange={onSettings} device={device} />
        {!projectId && (
          <>
            <DevicePicker value={pickedDevice} onChange={setPickedDevice} />
            {device ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="inline-flex h-7 max-w-48 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <FolderOpen className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{cwd ? folderName(cwd) : t("chat.folderButton")}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-md flex-col items-start gap-0.5 break-all">
                  <span>{t("chat.remoteDefaultFolder", { device: remoteName })}</span>
                  {cwd && <span className="font-mono opacity-70">{cwd}</span>}
                </TooltipContent>
              </Tooltip>
            ) : (
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
        )}
      </>
    ),
    [browse, cwd, device, onSettings, pickedDevice, projectId, remoteName, settings],
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
            <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
              <FolderGit2 className="size-4" />
              {t("chat.inProject")} <span className="font-medium text-foreground">{project.name}</span>
              <DeviceBadge device={device} />
            </span>
          ) : (
            t("chat.draftHint")
          )}
        </p>
        {projectId && <DraftContextPreview projectId={projectId} />}
      </div>
      {device === null && <AgentAccessNotice agent={settings.agent} />}
      <Composer
        threadId={null}
        projectId={projectId}
        slashAgent={settings.agent}
        slashCwd={project ? project.path : cwd || null}
        slashDevice={device}
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
