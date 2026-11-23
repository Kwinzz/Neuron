import { cn } from "cn";
import { Check, CornerDownLeft, Loader2, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import neuronMark from "@/assets/neuron-mark.png";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { AGENTS } from "@/lib/agents";
import { readChatDefaults } from "@/lib/chatDefaults";
import { formatRelative } from "@/lib/format";
import { ipc, ipcErrorMessage, quickWindow } from "@/lib/ipc";

/** Agents a quick request can start (generic CLIs need a profile picked in the app). */
const QUICK_AGENTS: readonly AgentKind[] = ["claude_code", "antigravity", "codex"];
const RECENT = 7;

function defaultAgent(): AgentKind {
  const agent = readChatDefaults().agent;
  return QUICK_AGENTS.includes(agent) ? agent : "claude_code";
}

/**
 * Global quick prompt (own window, opened by the system-wide shortcut): type a request and send it to a
 * new chat or to a recent one without leaving what you are doing. Like Ctrl+K, but it sends.
 */
export function QuickLauncher() {
  const [text, setText] = useState("");
  const [chats, setChats] = useState<ThreadSummary[]>([]);
  /** 0 = new chat, n = chats[n - 1]. */
  const [selected, setSelected] = useState(0);
  const [agent, setAgent] = useState<AgentKind>(defaultAgent);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const reset = useCallback(() => {
    setText("");
    setSelected(0);
    setAgent(defaultAgent());
    setState("idle");
    setError(null);
    ipc
      .listThreads(RECENT)
      .then(setChats)
      .catch(() => setChats([]));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

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

  const send = async (open: boolean) => {
    const prompt = text.trim();
    if (!prompt || state !== "idle") return;
    setState("sending");
    setError(null);
    try {
      let threadId: string;
      if (target) {
        await ipc.sendMessage(target.id, prompt);
        threadId = target.id;
      } else {
        const defaults = readChatDefaults();
        const same = defaults.agent === agent;
        const chat = await ipc.createThread({
          agent,
          cwd: null,
          model: same ? defaults.model : null,
          effort: same ? defaults.effort : null,
          permissionMode: defaults.permissionMode,
          title: null,
          projectId: null,
          prompt,
          attachments: [],
        });
        threadId = chat.id;
      }
      if (open) {
        await quickWindow.showThread(threadId);
        await quickWindow.hide();
        return;
      }
      setState("sent");
      window.setTimeout(() => void quickWindow.hide(), 650);
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
      e.preventDefault();
      setSelected(0);
      setAgent((a) => {
        const i = QUICK_AGENTS.indexOf(a);
        const step = e.shiftKey ? -1 : 1;
        return QUICK_AGENTS[(i + step + QUICK_AGENTS.length) % QUICK_AGENTS.length] ?? a;
      });
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
            placeholder={target ? `Message pour « ${target.title || "Chat sans titre"} »…` : "Demande quelque chose…"}
            aria-label="Ta demande"
            className="min-h-7 flex-1 resize-none bg-transparent text-base leading-7 outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          {state === "sending" && <Loader2 className="mt-1.5 size-4 shrink-0 animate-spin text-muted-foreground" />}
          {state === "sent" && (
            <span className="mt-1 flex shrink-0 items-center gap-1 text-sm text-ok animate-in fade-in-0 zoom-in-95 duration-150">
              <Check className="size-4" /> Envoyé
            </span>
          )}
        </div>

        {error && (
          <p className="border-t px-4 py-2 text-xs text-destructive select-text animate-in fade-in-0 duration-150">
            {error}
          </p>
        )}

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t p-1.5" aria-label="Destination">
          <li data-index={0}>
            <Row active={selected === 0} onSelect={() => setSelected(0)}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Plus className="size-4" />
              </span>
              <span className="font-medium">Nouveau chat</span>
              <span className="ml-auto flex items-center gap-1" role="radiogroup" aria-label="Agent du nouveau chat">
                {QUICK_AGENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={agent === a}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAgent(a);
                      setSelected(0);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors duration-150",
                      agent === a
                        ? "border-foreground/30 bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <AgentLogo agent={a} size={12} />
                    {AGENTS[a].label}
                  </button>
                ))}
              </span>
            </Row>
          </li>
          {chats.length > 0 && (
            <li className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden>
              Chats récents
            </li>
          )}
          {chats.map((chat, i) => (
            <li key={chat.id} data-index={i + 1}>
              <Row active={selected === i + 1} onSelect={() => setSelected(i + 1)}>
                <AgentLogo agent={chat.agent} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{chat.title || "Chat sans titre"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[chat.projectName, formatRelative(chat.updatedAt)].filter(Boolean).join(" · ")}
                </span>
              </Row>
            </li>
          ))}
        </ul>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          <Hint keys="↑ ↓">destination</Hint>
          <Hint keys="Tab">agent</Hint>
          <Hint keys="Ctrl ↵">envoyer et ouvrir</Hint>
          <Hint keys="Échap">fermer</Hint>
          <span className="ml-auto flex items-center gap-1.5 text-foreground">
            <CornerDownLeft className="size-3.5" /> Envoyer
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
