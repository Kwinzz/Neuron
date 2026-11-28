import { cn } from "cn";
import { Check, CornerDownLeft, Loader2, Plus } from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import neuronMark from "@/assets/neuron-mark.png";
import { EffortPicker } from "@/components/chat/EffortPicker";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { AgentLogo } from "@/components/ui/AgentLogo";
import {
  type QuickModel,
  readChatDefaults,
  readQuickModel,
  readQuickProject,
  saveQuickModel,
  saveQuickProject,
} from "@/lib/chatDefaults";
import { formatRelative } from "@/lib/format";
import { ipc, ipcErrorMessage, quickWindow } from "@/lib/ipc";
import { resolveModelId } from "@/stores/models";
import { QuickProjectPicker } from "./QuickProjectPicker";
import { t } from "@/i18n";

/** Agents a quick request can start (generic CLIs need a profile picked in the app). */
const QUICK_AGENTS: readonly AgentKind[] = ["claude_code", "antigravity", "codex"];
const RECENT = 7;
/** Threads fetched once per opening, filtered by project on the client. */
const FETCHED = 200;

/** Last agent + model used here, else the « Nouveau chat » defaults. */
function initialChoice(): QuickModel {
  const saved = readQuickModel();
  if (saved && QUICK_AGENTS.includes(saved.agent)) return saved;
  const { agent, model, effort } = readChatDefaults();
  return QUICK_AGENTS.includes(agent) ? { agent, model, effort } : { agent: "claude_code", model: null, effort: null };
}

/**
 * Global quick prompt (own window, opened by the system-wide shortcut): type a request and send it to a
 * new chat or to a recent one without leaving what you are doing. Like Ctrl+K, but it sends.
 */
export function QuickLauncher() {
  const [text, setText] = useState("");
  const [allChats, setAllChats] = useState<ThreadSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(readQuickProject);
  const [projectOpen, setProjectOpen] = useState(false);
  const project = projects.find((p) => p.id === projectId) ?? null;
  const setProjectId = (id: string | null) => {
    setProjectIdState(id);
    saveQuickProject(id);
    setSelected(0);
  };
  // In a project: its chats only.
  const chats = (project ? allChats.filter((c) => c.projectId === project.id) : allChats).slice(0, RECENT);
  /** 0 = new chat, n = chats[n - 1]. */
  const [selected, setSelected] = useState(0);
  const [choice, setChoiceState] = useState<QuickModel>(initialChoice);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const agent = choice.agent;
  const setChoice = (next: QuickModel) => {
    setChoiceState(next);
    saveQuickModel(next);
  };
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  const scheduleFocus = useCallback(() => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      inputRef.current?.focus();
    }, 0);
  }, []);

  const reset = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setText("");
    setSelected(0);
    setChoiceState(initialChoice());
    setPickerOpen(false);
    setEffortOpen(false);
    setProjectOpen(false);
    setProjectIdState(readQuickProject());
    setState("idle");
    setError(null);
    ipc
      .listThreads(FETCHED)
      .then(setAllChats)
      .catch(() => setAllChats([]));
    ipc
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    scheduleFocus();
  }, [scheduleFocus]);

  useEffect(() => {
    document.documentElement.classList.add("quick-window");
    reset();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    quickWindow
      .onOpened(reset)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [reset]);

  // Keep the selected row visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Grow with the text, up to 6 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  const count = chats.length + 1;
  const target = selected === 0 ? null : chats[selected - 1] ?? null;

  /** No text: just open the chosen chat (or the new-chat screen, in the project) in Neuron. */
  const openOnly = async () => {
    try {
      if (target) await quickWindow.showThread(target.id);
      else await quickWindow.showNewChat(project?.id ?? null);
      await quickWindow.hide();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const send = async (open: boolean) => {
    const prompt = text.trim();
    if (state !== "idle") return;
    if (!prompt) {
      void openOnly();
      return;
    }
    setState("sending");
    setError(null);
    try {
      let threadId: string;
      if (target) {
        await ipc.sendMessage(target.id, prompt);
        threadId = target.id;
      } else {
        const defaults = readChatDefaults();
        const chat = await ipc.createThread({
          agent,
          cwd: null,
          model: choice.model,
          effort: choice.effort,
          permissionMode: defaults.permissionMode,
          title: null,
          projectId: project?.id ?? null,
          prompt,
          attachments: [],
          workspace: null,
        });
        threadId = chat.id;
      }
      if (open) {
        await quickWindow.showThread(threadId);
        await quickWindow.hide();
        return;
      }
      setState("sent");
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        void quickWindow.hide();
      }, 650);
    } catch (err) {
      setState("idle");
      setError(ipcErrorMessage(err));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void quickWindow.hide();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (i - 1 + count) % count);
    } else if (e.key === "Tab") {
      // Next agent, with its default model.
      e.preventDefault();
      setSelected(0);
      const i = QUICK_AGENTS.indexOf(agent);
      const step = e.shiftKey ? -1 : 1;
      const next = QUICK_AGENTS[(i + step + QUICK_AGENTS.length) % QUICK_AGENTS.length] ?? agent;
      setChoice({ agent: next, model: null, effort: null });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
      e.preventDefault();
      setSelected(0);
      setPickerOpen(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      // Ctrl+R: reasoning level (the browser reload is disabled anyway, see browserKeys).
      e.preventDefault();
      setSelected(0);
      setEffortOpen(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setProjectOpen(true);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(e.ctrlKey || e.metaKey);
    }
  };

  return (
    <div className="flex h-full items-start justify-center p-3">
      <div
        className="flex max-h-full w-full flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-[0.98] duration-150"
        onMouseDown={(e) => {
          // Clicks anywhere keep the caret in the request field.
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
          <span
            aria-hidden
            className="mt-1 size-5 shrink-0 bg-foreground"
            style={{ mask: `url(${neuronMark}) center / contain no-repeat` }}
          />
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={state !== "idle"}
            placeholder={
              target
                ? t("quick.messageFor", { title: target.title || t("common.untitledChat") })
                : project
                  ? t("quick.askInProject", { project: project.name })
                  : t("quick.ask")
            }
            aria-label={t("quick.yourRequest")}
            className="min-h-7 flex-1 resize-none bg-transparent text-base leading-7 outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          {state === "sending" && <Loader2 className="mt-1.5 size-4 shrink-0 animate-spin text-muted-foreground" />}
          {state === "sent" && (
            <span className="mt-1 flex shrink-0 items-center gap-1 text-sm text-ok animate-in fade-in-0 zoom-in-95 duration-150">
              <Check className="size-4" /> {t("quick.sent")}
            </span>
          )}
        </div>

        {error && (
          <p className="border-t px-4 py-2 text-xs text-destructive select-text animate-in fade-in-0 duration-150">
            {error}
          </p>
        )}

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t p-1.5" aria-label={t("quick.destination")}>
          <li data-index={0}>
            <Row active={selected === 0} onSelect={() => setSelected(0)}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Plus className="size-4" />
              </span>
              <span className="font-medium">{t("quick.newChat")}</span>
              <span
                className="ml-auto flex items-center gap-1"
                // The pickers are popovers: keep the row selection, not the caret logic, for their clicks.
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <QuickProjectPicker
                  projects={projects}
                  value={project}
                  open={projectOpen}
                  onOpenChange={(open) => {
                    setProjectOpen(open);
                    if (!open) scheduleFocus();
                  }}
                  onChange={setProjectId}
                />
                <ModelPicker
                  agent={agent}
                  model={choice.model}
                  open={pickerOpen}
                  onOpenChange={(open) => {
                    setPickerOpen(open);
                    if (open) setSelected(0);
                    else scheduleFocus();
                  }}
                  listClassName="max-h-52"
                  onChange={(nextAgent, next) => {
                    if (!QUICK_AGENTS.includes(nextAgent)) return;
                    if (!next) {
                      setChoice({ agent: nextAgent, model: null, effort: null });
                      return;
                    }
                    // Same rule as the chat settings bar: keep the level only if the model accepts it.
                    const keep =
                      nextAgent === agent &&
                      choice.effort !== null &&
                      (next.efforts.length === 0 || next.efforts.includes(choice.effort));
                    const effort = keep ? choice.effort : null;
                    setChoice({ agent: nextAgent, model: resolveModelId(next, effort), effort });
                  }}
                />
                <EffortPicker
                  agent={agent}
                  model={choice.model}
                  effort={choice.effort}
                  open={effortOpen}
                  onOpenChange={(open) => {
                    setEffortOpen(open);
                    if (open) setSelected(0);
                  }}
                  // Back to the request field, not to the menu's button.
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    inputRef.current?.focus();
                  }}
                  className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  onChange={(effort, model) => setChoice({ ...choice, effort, model })}
                />
              </span>
            </Row>
          </li>
          {chats.length > 0 ? (
            <li className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden>
              {project ? t("quick.projectChats", { project: project.name }) : t("quick.recentChats")}
            </li>
          ) : (
            project && (
              <li className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground" aria-hidden>
                {t("quick.noChatsInProject", { project: project.name })}
              </li>
            )
          )}
          {chats.map((chat, i) => (
            <li key={chat.id} data-index={i + 1}>
              <Row active={selected === i + 1} onSelect={() => setSelected(i + 1)}>
                <AgentLogo agent={chat.agent} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{chat.title || t("common.untitledChat")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[project ? null : chat.projectName, formatRelative(chat.updatedAt)].filter(Boolean).join(" · ")}
                </span>
              </Row>
            </li>
          ))}
        </ul>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs whitespace-nowrap text-muted-foreground">
          <Hint keys="↑ ↓">{t("quick.hintChat")}</Hint>
          <Hint keys="Tab">{t("quick.hintAgent")}</Hint>
          <Hint keys="Ctrl M">{t("quick.hintModel")}</Hint>
          <Hint keys="Ctrl R">{t("quick.hintEffort")}</Hint>
          <Hint keys="Ctrl P">{t("quick.hintProject")}</Hint>
          <Hint keys="Ctrl ↵">{t("quick.hintSendOpen")}</Hint>
          <span className="ml-auto flex items-center gap-1.5 text-foreground">
            <CornerDownLeft className="size-3.5" /> {text.trim() ? t("quick.send") : t("common.open")}
          </span>
        </footer>
      </div>
    </div>
  );
}

function Row({ active, onSelect, children }: { active: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150",
        active ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      {children}
    </div>
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">{keys}</kbd>
      {children}
    </span>
  );
}
