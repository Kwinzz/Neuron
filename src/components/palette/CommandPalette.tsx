import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
  Archive,
  ArchiveRestore,
  Brain,
  ClipboardList,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Keyboard,
  LayoutDashboard,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import type { MessageHit } from "@/bindings/MessageHit";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { TOGGLE_PLAN_EVENT } from "@/components/chat/ModeSwitch";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { AgentLogo } from "@/components/ui/AgentLogo";
import {
  Command as CommandRoot,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DeviceBadge } from "@/components/ui/DeviceBadge";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { StatusDot } from "@/components/ui/StatusDot";
import { type MessageKey, t } from "@/i18n";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { RENAME_CHAT_EVENT, setChatArchived, setChatPinned } from "@/lib/chatActions";
import { readChatDefaults, setDefaultAgent } from "@/lib/chatDefaults";
import { deviceOfProject, deviceOfThread } from "@/lib/deviceRouting";
import { formatRelative } from "@/lib/format";
import { fuzzyScore, normalize } from "@/lib/fuzzy";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { openFolder } from "@/lib/openFolder";
import { STATUS, describeStatus } from "@/lib/status";
import { useChat } from "@/stores/chat";
import { useChatDeletion } from "@/stores/chatDeletion";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { useNewProject } from "@/stores/newProject";
import { toast } from "@/stores/toast";
import { type SettingsSection, useUi } from "@/stores/ui";
import { SETTINGS_SECTIONS } from "@/views/settings/SettingsNav";
import { MessageSnippet } from "./MessageSnippet";

interface Command {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  /** Extra text matched by the search but not displayed. */
  keywords?: string;
  /** Omit from the unfiltered empty-query palette. */
  hideWhenEmpty?: boolean;
  /** Normalized project name + path; shown only when the search query matches the project. */
  projectMatch?: string;
  /** Destructive styling (e.g. delete chat). */
  destructive?: boolean;
  /** Run after the palette dialog finishes closing (prevents Radix focus restoration conflicts). */
  runAfterClose?: boolean;
  icon: ReactNode;
  hint?: ReactNode;
  run: () => void | Promise<void>;
}

const MAX_PER_GROUP_EMPTY = 6;
const MAX_RESULTS = 40;
const MESSAGE_DEBOUNCE_MS = 200;
const MESSAGE_LIMIT = 15;
const EMPTY_PROJECTS: readonly ProjectSummary[] = [];

const SETTINGS_KEYWORDS: Record<SettingsSection, MessageKey> = {
  general: "shell.paletteSettingsGeneralKeywords",
  background: "shell.paletteSettingsBackgroundKeywords",
  agents: "shell.paletteSettingsAgentsKeywords",
  costs: "shell.paletteSettingsCostsKeywords",
  devices: "shell.paletteSettingsDevicesKeywords",
  notifications: "shell.paletteSettingsNotificationsKeywords",
  context: "shell.paletteSettingsContextKeywords",
  generic: "shell.paletteSettingsGenericKeywords",
  updates: "shell.paletteSettingsUpdatesKeywords",
};

/** Stop-words of « Nouveau chat dans » / « New chat in » so typing "nouveau" alone doesn't flood with every project. */
const PROJECT_ACTION_PREFIX_WORDS = new Set(["nouveau", "chat", "dans", "new", "in"]);

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const afterCloseRef = useRef<(() => void | Promise<void>) | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) afterCloseRef.current = null;
    setOpen(nextOpen);
  };

  const handleCloseAutoFocus = (e: Event) => {
    const fn = afterCloseRef.current;
    if (!fn) return;
    afterCloseRef.current = null;
    e.preventDefault();
    window.requestAnimationFrame(() => {
      Promise.resolve(fn()).catch((err: unknown) =>
        toast({ tone: "danger", title: t("shell.paletteCommandFailed"), description: ipcErrorMessage(err) }),
      );
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      onCloseAutoFocus={handleCloseAutoFocus}
      title={t("shell.paletteTitle")}
      description={t("shell.paletteDescription")}
      className="sm:max-w-xl"
    >
      {open && (
        <PaletteContent
          scheduleAfterClose={(fn) => {
            afterCloseRef.current = fn;
          }}
        />
      )}
    </CommandDialog>
  );
}

function useCommands(): Command[] {
  const ui = useUi.getState;
  const dockOpen = useUi((s) => s.dockOpen);
  const activeThreadId = useUi((s) => (s.view.kind === "thread" ? s.view.id : null));
  const activeLiveThread = useLive((s) => (activeThreadId ? s.threads[activeThreadId] : undefined));
  const activeNavThread = useNav((s) =>
    activeThreadId && !activeLiveThread ? s.chats.find((c) => c.id === activeThreadId) : undefined,
  );
  const activeThread = activeLiveThread ?? activeNavThread;

  const navProjects = useNav((s) => s.projects);
  const dashboardProjects = useDashboard((s) => s.snapshot?.projects);
  const projects = navProjects.length > 0 ? navProjects : (dashboardProjects ?? EMPTY_PROJECTS);

  const threadsMap = useLive((s) => s.threads);
  const threads = useMemo(
    () => Object.values(threadsMap).sort((a, b) => b.updatedAt - a.updatedAt),
    [threadsMap],
  );

  const defaultAgentLabel = (AGENTS[readChatDefaults().agent] ?? AGENTS.claude_code).label;

  return useMemo(() => {
    const openThread = (id: string) => {
      ui().focusThread(id);
      useLive.getState().markSeen(id);
    };

    const list: Command[] = [];

    if (activeThread) {
      const thisChatGroup = t("shell.paletteGroupThisChat");
      const threadId = activeThread.id;
      const isRunning = STATUS[activeThread.status].active;
      const isPinned = activeThread.pinnedAt !== null;
      const isArchived = activeThread.archivedAt !== null;
      const inPlanMode = activeThread.permissionMode === "plan";
      const activeDevice = deviceOfThread(threadId) ?? deviceOfProject(activeThread.projectId);

      list.push({
        id: "chat:rename",
        group: thisChatGroup,
        title: t("chat.rename"),
        keywords: t("shell.paletteRenameKeywords"),
        icon: <Pencil size={15} />,
        runAfterClose: true,
        run: () => {
          window.dispatchEvent(new CustomEvent(RENAME_CHAT_EVENT, { detail: threadId }));
        },
      });

      if (isRunning) {
        list.push({
          id: "chat:stop",
          group: thisChatGroup,
          title: t("chat.stopAgent"),
          keywords: t("shell.paletteStopKeywords"),
          icon: <Square size={15} className="fill-current" />,
          hint: <CommandShortcut>{t("shell.keyEscape")} ×2</CommandShortcut>,
          run: () => useChat.getState().stop(threadId),
        });
      }

      list.push({
        id: "chat:pin",
        group: thisChatGroup,
        title: t(isPinned ? "chat.unpin" : "chat.pin"),
        keywords: t("shell.palettePinKeywords"),
        icon: isPinned ? <PinOff size={15} /> : <Pin size={15} />,
        run: () => setChatPinned(threadId, !isPinned),
      });

      list.push({
        id: "chat:archive",
        group: thisChatGroup,
        title: t(isArchived ? "chat.unarchive" : "chat.archive"),
        keywords: t("shell.paletteArchiveKeywords"),
        icon: isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
        run: () => setChatArchived(threadId, !isArchived),
      });

      if (activeThread.agent !== "generic") {
        list.push({
          id: "chat:plan-mode",
          group: thisChatGroup,
          title: t(inPlanMode ? "shell.paletteLeavePlanMode" : "shell.paletteEnterPlanMode"),
          subtitle: t(inPlanMode ? "chat.modeRunHint" : "chat.modePlanHint"),
          keywords: t("shell.palettePlanModeKeywords"),
          icon: inPlanMode ? <Play size={15} /> : <ClipboardList size={15} />,
          hint: <CommandShortcut>{t("shell.keyShift")}+Tab</CommandShortcut>,
          run: () => {
            window.dispatchEvent(new Event(TOGGLE_PLAN_EVENT));
          },
        });
      }

      if (activeThread.cwd && !activeDevice) {
        const dir = activeThread.cwd;
        list.push({
          id: "chat:open-folder",
          group: thisChatGroup,
          title: t("common.openFolder"),
          subtitle: dir,
          keywords: t("shell.paletteOpenFolderKeywords"),
          icon: <FolderOpen size={15} />,
          run: () => openFolder(dir),
        });
      }

      list.push({
        id: "chat:delete",
        group: thisChatGroup,
        title: t("chat.deleteChat"),
        keywords: t("shell.paletteDeleteKeywords"),
        icon: <Trash2 size={15} />,
        destructive: true,
        runAfterClose: true,
        run: () => useChatDeletion.getState().request(threadId),
      });
    }

    list.push(
      {
        id: "thread:new",
        group: t("shell.paletteGroupActions"),
        title: t("shell.navNewChat"),
        subtitle: t("shell.paletteNewChatSubtitle", { agent: defaultAgentLabel }),
        keywords: t("shell.paletteNewChatKeywords"),
        icon: <Plus size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+N</CommandShortcut>,
        run: () => ui().startChat(null),
      },
      {
        id: "project:new",
        group: t("shell.paletteGroupActions"),
        title: t("shell.newProjectTitle"),
        subtitle: t("shell.paletteNewProjectSubtitle"),
        keywords: t("shell.paletteNewProjectKeywords"),
        icon: <FolderPlus size={15} />,
        run: () => useNewProject.getState().show(null),
      },
    );

    for (const agent of AGENT_ORDER) {
      const meta = AGENTS[agent];
      list.push({
        id: `thread:new:agent:${agent}`,
        group: t("shell.paletteGroupActions"),
        title: t("shell.paletteNewChatWithAgent", { agent: meta.label }),
        keywords: `${t("shell.paletteNewChatWithAgentKeywords", { agent: meta.label, short: meta.short })} ${agent}`,
        icon: <AgentLogo agent={agent} size={15} />,
        run: () => {
          setDefaultAgent(agent);
          ui().startChat(null, agent);
        },
      });
    }

    list.push(
      {
        id: "nav:home",
        group: t("shell.scGroupNavigation"),
        title: t("shell.navHome"),
        subtitle: t("shell.paletteHomeSubtitle"),
        keywords: t("shell.paletteHomeKeywords"),
        icon: <LayoutDashboard size={15} />,
        run: () => ui().navigate({ kind: "home" }),
      },
      {
        id: "nav:memory",
        group: t("shell.scGroupNavigation"),
        title: t("shell.navMemory"),
        subtitle: t("shell.paletteMemorySubtitle"),
        keywords: t("shell.paletteMemoryKeywords"),
        icon: <Brain size={15} />,
        run: () => ui().navigate({ kind: "memory" }),
      },
      {
        id: "nav:settings",
        group: t("shell.scGroupNavigation"),
        title: t("shell.navSettings"),
        subtitle: t("shell.paletteSettingsSubtitle"),
        keywords: t("shell.paletteSettingsKeywords"),
        icon: <Settings size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+,</CommandShortcut>,
        run: () => ui().openSettings(),
      },
      {
        id: "nav:shortcuts",
        group: t("shell.scGroupNavigation"),
        title: t("shell.shortcutsTitle"),
        keywords: t("shell.paletteShortcutsKeywords"),
        icon: <Keyboard size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+/</CommandShortcut>,
        run: () => ui().setShortcutsOpen(true),
      },
      {
        id: "nav:dock",
        group: t("shell.scGroupNavigation"),
        title: dockOpen ? t("shell.paletteDockHide") : t("shell.paletteDockShow"),
        keywords: t("shell.paletteDockKeywords"),
        icon: <PanelRight size={15} />,
        hint: <CommandShortcut>{MOD_LABEL}+J</CommandShortcut>,
        run: () => ui().toggleDock(),
      },
    );

    for (const th of threads) {
      const active = STATUS[th.status].active;
      list.push({
        id: `thread:${th.id}`,
        group: active ? t("shell.paletteGroupActiveChats") : t("shell.paletteGroupRecentChats"),
        title: th.title || t("common.untitledChat"),
        subtitle: [th.projectName, active ? describeStatus(th.status, th.detail) : formatRelative(th.updatedAt)]
          .filter(Boolean)
          .join(" · "),
        keywords: `${th.agent} ${th.model ?? ""}`,
        icon: active ? <StatusDot status={th.status} /> : <AgentLogo agent={th.agent} size={15} />,
        hint: <AgentBadge agent={th.agent} variant="short" className="text-xs" />,
        run: () => openThread(th.id),
      });
    }

    for (const p of projects) {
      const device = deviceOfProject(p.id);
      list.push({
        id: `project:${p.id}`,
        group: t("shell.projects"),
        title: p.name,
        subtitle: p.path,
        icon: <FolderGit2 size={15} />,
        hint: (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <DeviceBadge device={device} compact />
            <CommandShortcut className="ml-0 tracking-normal">{t("shell.paletteChatCount", { n: p.threadCount })}</CommandShortcut>
          </div>
        ),
        run: () => {
          ui().openProject(p.id, "context");
        },
      });
      list.push({
        id: `thread:new:project:${p.id}`,
        group: t("shell.projects"),
        title: t("shell.paletteNewChatInProject", { project: p.name }),
        subtitle: p.path,
        keywords: t("shell.paletteNewChatInProjectKeywords", { project: p.name }),
        hideWhenEmpty: true,
        projectMatch: normalize(`${p.name} ${p.path}`),
        icon: <Plus size={15} />,
        hint: device ? <DeviceBadge device={device} compact /> : undefined,
        run: () => ui().startChat(p.id),
      });
    }

    const settingsGroup = t("shell.navSettings");
    for (const item of SETTINGS_SECTIONS) {
      const Icon = item.icon;
      list.push({
        id: `settings:${item.id}`,
        group: settingsGroup,
        title: t(item.label),
        keywords: t(SETTINGS_KEYWORDS[item.id]),
        icon: <Icon size={15} />,
        run: () => ui().openSettings(item.id),
      });
    }

    return list;
  }, [activeThread, defaultAgentLabel, dockOpen, projects, threads, ui]);
}

function matchesProjectQuery(q: string, projectMatch: string): boolean {
  if (fuzzyScore(q, projectMatch) !== null) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.some((tok) => !PROJECT_ACTION_PREFIX_WORDS.has(tok) && fuzzyScore(tok, projectMatch) !== null);
}

function filterCommands(commands: Command[], query: string): Command[] {
  const q = normalize(query.trim());
  if (!q) {
    const uncapped = new Set([t("shell.paletteGroupThisChat"), t("shell.navSettings")]);
    const perGroup = new Map<string, number>();
    return commands.filter((c) => {
      if (c.hideWhenEmpty) return false;
      if (uncapped.has(c.group)) return true;
      const n = perGroup.get(c.group) ?? 0;
      perGroup.set(c.group, n + 1);
      return n < MAX_PER_GROUP_EMPTY;
    });
  }
  return commands
    .map((c) => {
      if (c.projectMatch !== undefined && !matchesProjectQuery(q, c.projectMatch)) {
        return { c, score: -Infinity };
      }
      const titleScore = fuzzyScore(q, normalize(c.title));
      const restScore = fuzzyScore(q, normalize(`${c.subtitle ?? ""} ${c.keywords ?? ""} ${c.group}`));
      const score = Math.max(titleScore ?? -Infinity, restScore === null ? -Infinity : restScore - 300);
      return { c, score };
    })
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((r) => r.c);
}

function useMessageSearch(query: string): { hits: MessageHit[]; searching: boolean } {
  const trimmed = query.trim();
  const enabled = trimmed.length >= 2 && isTauri();
  const [result, setResult] = useState<{ query: string; hits: MessageHit[] }>({ query: "", hits: [] });
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!enabled) {
      setResult((prev) => (prev.query === "" && prev.hits.length === 0 ? prev : { query: "", hits: [] }));
      return;
    }

    const timer = window.setTimeout(() => {
      ipc
        .searchMessages(trimmed, MESSAGE_LIMIT)
        .then((hits) => {
          if (requestIdRef.current !== requestId) return;
          setResult({ query: trimmed, hits });
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setResult({ query: trimmed, hits: [] });
        });
    }, MESSAGE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [trimmed, enabled]);

  if (!enabled) return { hits: [], searching: false };
  return { hits: result.hits, searching: result.query !== trimmed };
}

function PaletteContent({
  scheduleAfterClose,
}: {
  scheduleAfterClose: (fn: () => void | Promise<void>) => void;
}) {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of results) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map.entries()];
  }, [results]);
  const { hits: messageHits, searching: searchingMessages } = useMessageSearch(query);

  const run = (cmd: Command) => {
    if (cmd.runAfterClose) {
      scheduleAfterClose(cmd.run);
      setOpen(false);
      return;
    }
    setOpen(false);
    Promise.resolve(cmd.run()).catch((err: unknown) =>
      toast({ tone: "danger", title: t("shell.paletteCommandFailed"), description: ipcErrorMessage(err) }),
    );
  };

  const openMessageHit = (hit: MessageHit) => {
    setOpen(false);
    useUi.getState().focusThread(hit.threadId);
    useLive.getState().markSeen(hit.threadId);
  };

  return (
    <CommandRoot shouldFilter={false} loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder={t("shell.palettePlaceholder")} />
      <CommandList className="max-h-[420px]">
        <CommandEmpty className="animate-in fade-in-0 duration-150">
          {searchingMessages ? t("shell.paletteSearchingMessages") : t("shell.paletteNoResult", { query })}
        </CommandEmpty>
        {groups.map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                onSelect={() => run(cmd)}
                className={cn(
                  "animate-in fade-in-0 duration-150",
                  cmd.destructive && "text-destructive data-selected:text-destructive data-selected:*:[svg]:text-destructive",
                )}
              >
                {cmd.icon}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{cmd.title}</span>
                  {cmd.subtitle && <span className="truncate text-xs text-muted-foreground">{cmd.subtitle}</span>}
                </div>
                {cmd.hint}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {messageHits.length > 0 && (
          <CommandGroup
            heading={t("shell.paletteGroupMessages")}
            className={cn("transition-opacity duration-150", searchingMessages && "opacity-70")}
          >
            {messageHits.map((hit) => {
              const liveTitle = useLive.getState().threads[hit.threadId]?.title;
              const title = liveTitle || hit.threadTitle || t("common.untitledChat");
              const device = deviceOfThread(hit.threadId) ?? deviceOfProject(hit.projectId);
              return (
                <CommandItem
                  key={`msg:${hit.messageId}`}
                  value={`msg:${hit.messageId}`}
                  onSelect={() => openMessageHit(hit)}
                  className="items-start animate-in fade-in-0 duration-150"
                >
                  <AgentLogo agent={hit.agent} size={15} className="mt-0.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                      <DeviceBadge device={device} compact />
                      <CommandShortcut className="shrink-0 tracking-normal tabular-nums">
                        {formatRelative(hit.ts)}
                      </CommandShortcut>
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      <MessageSnippet snippet={hit.snippet} />
                    </span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandRoot>
  );
}
