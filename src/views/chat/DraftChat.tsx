import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DraftContextPreview } from "@/components/context/DraftContextPreview";
import type { AgentKind } from "@/bindings/AgentKind";
import type { Attachment } from "@/bindings/Attachment";
import type { RemoteHost } from "@/bindings/RemoteHost";
import { AlertTriangle, ArrowRightLeft, FolderGit2, FolderOpen, MessageSquarePlus } from "lucide-react";
import { AgentAccessNotice } from "@/components/chat/AgentAccessNotice";
import { ChatSettingsBar } from "@/components/chat/ChatSettingsBar";
import { DevicePicker } from "@/components/chat/DevicePicker";
import { Button } from "@/components/ui/button";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startChatWithDevices, validateCrossDevice } from "@/lib/crossDevice";
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

const EMPTY_HOSTS: readonly RemoteHost[] = [];

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Empty chat: pick model / reasoning / permissions, type, and the chat is created on send. */
export function DraftChat({ projectId, agent }: { projectId: string | null; agent?: AgentKind }) {
  const view = useUi((s) => s.view);
  const project = useNav((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const projectDevice = deviceOfProject(projectId);
  const hosts = useDevices((s) => s.devices?.hosts) ?? EMPTY_HOSTS;
  const capabilities = useDevices((s) => s.capabilities);
  const [pickedWorkspaceDevice, setPickedWorkspaceDevice] = useState<string | null>(null);
  const [pickedAiDevice, setPickedAiDevice] = useState<string | null | undefined>(undefined);
  const workspaceDevice = projectId ? projectDevice : pickedWorkspaceDevice;
  // By default AI runs on the same device as the workspace; the user may pick another paired device.
  const aiDevice = pickedAiDevice === undefined ? workspaceDevice : pickedAiDevice;
  const isCrossDevice = aiDevice !== workspaceDevice;

  // Reset manual AI override when switching projects.
  useEffect(() => {
    setPickedAiDevice(undefined);
  }, [projectId]);

  const deviceNameOf = useCallback(
    (id: string | null) =>
      id ? (hosts.find((h) => h.nodeId === id)?.name ?? t("shell.unknownDevice")) : t("chat.thisPc"),
    [hosts],
  );
  const [settings, setSettings] = useState<ChatSettings>(() => {
    const defaults = readChatDefaults();
    if (!agent || defaults.agent === agent) return defaults;
    return { ...defaults, agent, model: null, effort: null };
  });
  const [cwd, setCwd] = useState<string>("");
  const manualCwdRef = useRef(false);

  // Sync the draft's agent when started with an explicit agent (e.g. from Ctrl+K) while DraftChat is already mounted.
  useEffect(() => {
    if (view.kind !== "draft" || !view.agent) return;
    const target = view.agent;
    setSettings((cur) => (cur.agent === target ? cur : { ...cur, agent: target, model: null, effort: null }));
  }, [view]);

  // When switching AI device, fall back to its default model if the chosen one does not exist there.
  const deviceProviders = useDeviceProviders(aiDevice);
  const providersLoaded = useModels((s) => (aiDevice ? Boolean(s.remoteLoaded[aiDevice]) : s.loaded));
  const lastCheckedDeviceRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastCheckedDeviceRef.current === aiDevice) return;
    if (!providersLoaded) return;
    lastCheckedDeviceRef.current = aiDevice;
    if (deviceProviders.length === 0) return;
    setSettings((cur) => {
      if (cur.model === null) return cur;
      if (findModel(deviceProviders, cur.agent, cur.model)) return cur;
      return { ...cur, model: null, effort: null };
    });
  }, [aiDevice, deviceProviders, providersLoaded]);

  useEffect(() => {
    if (projectId) return;
    let cancelled = false;
    manualCwdRef.current = false;
    setCwd("");
    ipc
      .defaultCwd(workspaceDevice)
      .then((dir) => {
        if (!cancelled && !manualCwdRef.current) setCwd(dir);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, workspaceDevice]);

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

  const crossCheck = useMemo(
    () => validateCrossDevice(settings.agent, aiDevice, workspaceDevice, capabilities, (id) => deviceNameOf(id)),
    [settings.agent, aiDevice, workspaceDevice, capabilities, deviceNameOf],
  );

  const submit = useCallback(
    async (text: string, attachments: Attachment[]) => {
      if (!crossCheck.ok) {
        toast({
          tone: "danger",
          title: t("chat.startChatFailed"),
          description: crossCheck.reason ?? undefined,
        });
        return false;
      }
      try {
        const chat = await startChatWithDevices({
          input: {
            agent: settings.agent,
            cwd: projectId || workspaceDevice ? null : cwd || null,
            model: settings.model,
            effort: settings.effort,
            permissionMode: settings.permissionMode,
            title: null,
            projectId,
            prompt: text,
            attachments,
          },
          aiDevice,
          workspaceDevice,
          project: project ?? null,
          workspaceCwd: cwd || null,
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
    [aiDevice, crossCheck.ok, crossCheck.reason, cwd, project, projectId, settings, workspaceDevice],
  );

  const remoteName = deviceNameOf(workspaceDevice);

  const toolbar = useMemo(
    () => (
      <>
        <ChatSettingsBar value={settings} onChange={onSettings} device={aiDevice} />
        {projectId ? (
          <DevicePicker labelMode="ai" value={aiDevice} onChange={setPickedAiDevice} />
        ) : (
          <>
            <DevicePicker
              labelMode="ai"
              value={aiDevice}
              onChange={(next) => setPickedAiDevice(next)}
            />
            <DevicePicker
              labelMode="workspace"
              value={workspaceDevice}
              onChange={(next) => {
                setPickedWorkspaceDevice(next);
                if (pickedAiDevice === undefined) return;
              }}
            />
            {workspaceDevice ? (
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
    [aiDevice, browse, cwd, onSettings, pickedAiDevice, projectId, remoteName, settings, workspaceDevice],
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
              <DeviceBadge device={workspaceDevice} />
            </span>
          ) : (
            t("chat.draftHint")
          )}
        </p>
        {projectId && <DraftContextPreview projectId={projectId} />}
      </div>
      {isCrossDevice && (
        <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
          {crossCheck.ok ? (
            <>
              <ArrowRightLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">
                {t("chat.crossDeviceSummary", {
                  ai: deviceNameOf(aiDevice),
                  workspace: deviceNameOf(workspaceDevice),
                })}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden />
              <span className="text-warn">{crossCheck.reason}</span>
            </>
          )}
        </div>
      )}
      {aiDevice === null && <AgentAccessNotice agent={settings.agent} />}
      <Composer
        threadId={null}
        projectId={projectId}
        slashAgent={settings.agent}
        slashCwd={project ? project.path : cwd || null}
        slashDevice={aiDevice}
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
