import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, ArrowUpRight, Folder, FolderPlus, Loader2, MessageSquarePlus } from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { RemoteHost } from "@/bindings/RemoteHost";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { ChatSettingsBar } from "@/components/chat/ChatSettingsBar";
import { DevicePicker } from "@/components/chat/DevicePicker";
import { TOGGLE_PLAN_EVENT } from "@/components/chat/ModeSwitch";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { readChatDefaults, saveChatDefaults } from "@/lib/chatDefaults";
import { startChatWithDevices, validateCrossDevice } from "@/lib/crossDevice";
import { deviceOfProject } from "@/lib/deviceRouting";
import { ipcErrorMessage } from "@/lib/ipc";
import type { ChatSettings } from "@/lib/models";
import { useDashboard } from "@/stores/dashboard";
import { useDevices } from "@/stores/devices";
import { useLive } from "@/stores/live";
import { findModel, useDeviceProviders, useModels } from "@/stores/models";
import { useNav } from "@/stores/nav";
import { useNewProject } from "@/stores/newProject";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import { HomeProjectPicker } from "./HomeProjectPicker";

const MAX_RECENT_PROJECTS = 6;
const EMPTY_PROJECTS: readonly ProjectSummary[] = [];
const EMPTY_CHATS: readonly ThreadSummary[] = [];
const EMPTY_HOSTS: readonly RemoteHost[] = [];

/**
 * Action-first top card on Accueil: compact prompt input (same agent/model/effort/permissions flow as DraftChat
 * plus a project picker) that creates and opens the chat on send, followed by up to 6 recent projects.
 */
export function StartChatCard() {
  const navProjects = useNav((s) => s.projects);
  const navChats = useNav((s) => s.chats);
  const dashboardProjects = useDashboard((s) => s.snapshot?.projects);
  const dashboardRecent = useDashboard((s) => s.snapshot?.recentThreads);
  const hosts = useDevices((s) => s.devices?.hosts) ?? EMPTY_HOSTS;
  const capabilities = useDevices((s) => s.capabilities);

  const projects = navProjects.length > 0 ? navProjects : (dashboardProjects ?? EMPTY_PROJECTS);
  const chats = navChats.length > 0 ? navChats : (dashboardRecent ?? EMPTY_CHATS);

  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pickedDevice, setPickedDevice] = useState<string | null>(null);
  const [pickedAiDevice, setPickedAiDevice] = useState<string | null | undefined>(undefined);
  const [settings, setSettings] = useState<ChatSettings>(readChatDefaults);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const project = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) ?? null : null),
    [projects, projectId],
  );
  const resolvedProjectId = project?.id ?? null;
  const workspaceDevice = resolvedProjectId ? deviceOfProject(resolvedProjectId) : pickedDevice;
  const aiDevice = pickedAiDevice === undefined ? workspaceDevice : pickedAiDevice;

  useEffect(() => {
    setPickedAiDevice(undefined);
  }, [resolvedProjectId]);

  const deviceNameOf = useCallback(
    (id: string | null) =>
      id ? (hosts.find((h) => h.nodeId === id)?.name ?? t("shell.unknownDevice")) : t("chat.thisPc"),
    [hosts],
  );

  // Keep the chosen model valid when switching the AI device.
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

  // Grow textarea with content up to 160 px (JS height: WebKitGTK has no field-sizing).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const recentProjects = useMemo(() => {
    if (projects.length === 0) return EMPTY_PROJECTS;
    const latestChatByProject = new Map<string, number>();
    for (const c of chats) {
      const pid = c.projectId ?? c.workspace?.projectId ?? null;
      if (!pid) continue;
      const prev = latestChatByProject.get(pid) ?? 0;
      if (c.updatedAt > prev) latestChatByProject.set(pid, c.updatedAt);
    }
    return [...projects]
      .sort((a, b) => {
        const aTs = Math.max(a.lastOpenedAt ?? 0, latestChatByProject.get(a.id) ?? 0, a.createdAt);
        const bTs = Math.max(b.lastOpenedAt ?? 0, latestChatByProject.get(b.id) ?? 0, b.createdAt);
        return bTs - aTs || a.name.localeCompare(b.name);
      })
      .slice(0, MAX_RECENT_PROJECTS);
  }, [projects, chats]);

  const onSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    saveChatDefaults(next);
  }, []);

  const crossCheck = useMemo(
    () => validateCrossDevice(settings.agent, aiDevice, workspaceDevice, capabilities, (id) => deviceNameOf(id)),
    [settings.agent, aiDevice, workspaceDevice, capabilities, deviceNameOf],
  );

  const canSend = text.trim().length > 0 && !sending && crossCheck.ok;

  const submit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || sending || !crossCheck.ok) return;
    setSending(true);
    try {
      const chat = await startChatWithDevices({
        input: {
          agent: settings.agent,
          cwd: null,
          model: settings.model,
          effort: settings.effort,
          permissionMode: settings.permissionMode,
          title: null,
          projectId: resolvedProjectId,
          prompt,
          attachments: [],
        },
        aiDevice,
        workspaceDevice,
        project,
      });
      setText("");
      useLive.getState().hydrate([chat]);
      useUi.getState().focusThread(chat.id);
      void useNav.getState().load();
      useDashboard.getState().scheduleRefresh();
    } catch (err) {
      toast({ tone: "danger", title: t("chat.startChatFailed"), description: ipcErrorMessage(err) });
    } finally {
      setSending(false);
    }
  }, [aiDevice, crossCheck.ok, project, resolvedProjectId, sending, settings, text, workspaceDevice]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Tab" && e.shiftKey && settings.agent !== "generic") {
      e.preventDefault();
      window.dispatchEvent(new Event(TOGGLE_PLAN_EVENT));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("home.startChatTitle")}</span>
        </CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => useUi.getState().startChat(resolvedProjectId)}
          >
            <span>{t("home.startChatFullView")}</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col rounded-xl border bg-background transition-colors duration-150 focus-within:border-ring/70">
          <textarea
            ref={textareaRef}
            rows={2}
            value={text}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              project
                ? t("home.startChatPlaceholderInProject", { project: project.name })
                : t("home.startChatPlaceholder")
            }
            aria-label={t("home.startChatAria")}
            className="min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-2 py-1.5">
            <HomeProjectPicker
              projects={projects}
              value={project}
              onChange={setProjectId}
              disabled={sending}
            />
            <ChatSettingsBar value={settings} onChange={onSettings} device={aiDevice} disabled={sending} />
            {resolvedProjectId ? (
              <DevicePicker
                labelMode="ai"
                value={aiDevice}
                onChange={setPickedAiDevice}
                disabled={sending}
              />
            ) : (
              <DevicePicker value={pickedDevice} onChange={setPickedDevice} disabled={sending} />
            )}
            <div className="ml-auto flex items-center">
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                disabled={!canSend}
                onClick={() => void submit()}
              >
                {sending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <ArrowUp className="size-3.5" aria-hidden />
                )}
                <span>{t("chat.send")}</span>
              </Button>
            </div>
          </div>
        </div>
        {!crossCheck.ok && crossCheck.reason && (
          <div className="flex items-center gap-2 text-xs text-warn">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>{crossCheck.reason}</span>
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("home.recentProjectsTitle")}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => useNewProject.getState().show(null)}
            >
              <FolderPlus className="size-3.5" aria-hidden />
              <span>{t("shell.addProject")}</span>
            </Button>
          </div>

          {recentProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("home.recentProjectsEmpty")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 @lg/main:grid-cols-2 @4xl/main:grid-cols-3">
              {recentProjects.map((p) => {
                const projDevice = deviceOfProject(p.id);
                return (
                  <div
                    key={p.id}
                    className="group flex min-w-0 items-center gap-1 rounded-lg border bg-background/50 p-1 transition-colors duration-150 hover:bg-accent/50"
                  >
                    <button
                      type="button"
                      onClick={() => useUi.getState().startChat(p.id)}
                      title={t("home.recentProjectNewChat", { name: p.name })}
                      aria-label={t("home.recentProjectNewChat", { name: p.name })}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                          <DeviceBadge device={projDevice} compact />
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="tabular-nums">{t("shell.paletteChatCount", { n: p.threadCount })}</span>
                          {p.activeCount > 0 && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="tabular-nums text-live">
                                {t("project.activeCount", { n: p.activeCount })}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("home.recentProjectOpen", { name: p.name })}
                          className="shrink-0 text-muted-foreground opacity-70 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => useUi.getState().openProject(p.id, "context")}
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("chat.openProject")}</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
