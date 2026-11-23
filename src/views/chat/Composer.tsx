import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import { cn } from "cn";
import type { AgentKind } from "@/bindings/AgentKind";
import type { Attachment } from "@/bindings/Attachment";
import type { SlashCommand } from "@/bindings/SlashCommand";
import { TOGGLE_PLAN_EVENT } from "@/components/chat/ModeSwitch";
import { SlashMenu } from "@/components/chat/SlashMenu";
import { AGENTS } from "@/lib/agents";
import { fuzzyScore, normalize } from "@/lib/fuzzy";
import { useLive } from "@/stores/live";
import { EMPTY_COMMANDS, slashKey, useSlash } from "@/stores/slash";
import { AttachmentTray } from "@/components/attachments/AttachmentTray";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ThreadSettingsBar } from "@/components/chat/ThreadSettingsBar";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { useChat } from "@/stores/chat";
import { NewMessagesPill } from "./NewMessagesPill";

const MAX_TEXTAREA_HEIGHT = 10 * 24 + 16;

/** ArrayBuffer → base64, in chunks (no stack overflow on large images). */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Clipboard images are all called "image.png": give them a readable, unique name. */
function pastedName(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toLocaleTimeString("fr-FR").replace(/:/g, "-");
  return `image-collee-${stamp}.${ext}`;
}

interface ComposerProps {
  /** null = draft chat (not created yet): `submit` handles the first message. */
  threadId: string | null;
  projectId: string | null;
  /** Custom submit (draft chat). Resolve true when the message was accepted. */
  submit?: (text: string, attachments: Attachment[]) => Promise<boolean>;
  /** Left side of the bottom bar. Defaults to the chat's model / effort / permission selectors. */
  toolbar?: ReactNode;
  placeholder?: string;
  active: boolean;
  onSent: () => void;
  /** Show the floating "Nouveaux messages" pill above the input. */
  showPill: boolean;
  onPillClick: () => void;
  /** Provider + folder for the « / » menu (draft chat). Existing chats read them from the live store. */
  slashAgent?: AgentKind;
  slashCwd?: string | null;
  /** Same column as the timeline, whose left gutter (pl-10) holds the agent cursor. */
  timelineGutter?: boolean;
}

/** Max rows in the « / » menu. */
const SLASH_LIMIT = 50;

function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands.slice(0, SLASH_LIMIT);
  const q = normalize(query);
  return commands
    .map((c) => ({ c, score: fuzzyScore(q, normalize(c.name)) }))
    .filter((r): r is { c: SlashCommand; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, SLASH_LIMIT)
    .map((r) => r.c);
}

/** Sticky message input. Memoized: the parent re-renders on every streamed frame, this must not. */
export const Composer = memo(function Composer({
  threadId,
  projectId,
  submit,
  toolbar,
  placeholder,
  active,
  onSent,
  showPill,
  onPillClick,
  slashAgent,
  slashCwd,
  timelineGutter = false,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Files being copied/saved (skeleton tiles; sending waits for them). */
  const [importing, setImporting] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // « / » menu: provider commands while the message is a single « /word ».
  const liveAgent = useLive((st) => (threadId ? st.threads[threadId]?.agent : undefined));
  const liveCwd = useLive((st) => (threadId ? (st.threads[threadId]?.cwd ?? null) : null));
  const agent = slashAgent ?? liveAgent;
  const cwd = slashCwd !== undefined ? slashCwd : liveCwd;
  const slashQuery = /^\/\S*$/.test(value) ? value.slice(1) : null;
  const [slashDismissedAt, setSlashDismissedAt] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashOpen = slashQuery !== null && agent !== undefined && agent !== "generic" && slashDismissedAt !== value;
  const slashEntry = useSlash((st) => (agent ? st.entries[slashKey(agent, cwd)] : undefined));
  const slashCommands = slashEntry?.commands ?? EMPTY_COMMANDS;
  const slashFiltered = useMemo(
    () => (slashOpen ? rankCommands(slashCommands, slashQuery ?? "") : EMPTY_COMMANDS),
    [slashOpen, slashCommands, slashQuery],
  );
  useEffect(() => {
    if (slashOpen && agent) useSlash.getState().load(agent, cwd);
  }, [slashOpen, agent, cwd]);
  useEffect(() => setSlashIndex(0), [slashQuery]);

  // Stable: the menu rows are memoized.
  const pickSlash = useCallback((command: SlashCommand) => {
    pendingCaretEndRef.current = true;
    setValue(`/${command.name} `);
    textareaRef.current?.focus();
  }, []);

  const historyRef = useRef<string[] | null>(null);
  const historyProjectRef = useRef<string | null>(projectId);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef("");
  const pendingCaretEndRef = useRef(false);
  const fetchingHistoryRef = useRef(false);

  if (historyProjectRef.current !== projectId) {
    historyProjectRef.current = projectId;
    historyRef.current = null;
    historyIndexRef.current = -1;
  }

  useEffect(() => {
    textareaRef.current?.focus();
    historyIndexRef.current = -1;
  }, [threadId]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    if (pendingCaretEndRef.current) {
      pendingCaretEndRef.current = false;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [value]);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && importing === 0;

  const sendCurrent = async () => {
    const trimmed = value.trim();
    if (!canSend) return;

    const previous = value;
    const sentAttachments = attachments;
    setValue("");
    setAttachments([]);
    historyIndexRef.current = -1;
    draftRef.current = "";
    onSent();

    const ok = submit
      ? await submit(trimmed, sentAttachments)
      : threadId
        ? await useChat.getState().send(threadId, trimmed, sentAttachments)
        : false;
    if (!ok) {
      setValue((current) => (current === "" ? previous : current));
      setAttachments((current) => (current.length === 0 ? sentAttachments : current));
      return;
    }

    if (trimmed && historyRef.current !== null && historyRef.current[0] !== trimmed) {
      historyRef.current = [trimmed, ...historyRef.current];
    }
  };

  /** Run an import, showing `count` skeleton tiles meanwhile. */
  const addAttachments = async (count: number, load: () => Promise<Attachment[]>) => {
    setImporting((n) => n + count);
    try {
      const added = await load();
      setAttachments((current) => [...current, ...added]);
    } catch (err) {
      toast({ tone: "danger", title: "Pièce jointe refusée", description: ipcErrorMessage(err) });
    } finally {
      setImporting((n) => Math.max(0, n - count));
      textareaRef.current?.focus();
    }
  };

  const pickFiles = async () => {
    let paths: string[];
    try {
      paths = await ipc.pickFiles();
    } catch (err) {
      toast({ tone: "danger", title: "Sélection impossible", description: ipcErrorMessage(err) });
      return;
    }
    if (paths.length > 0) void addAttachments(paths.length, () => ipc.importAttachments(paths));
  };

  // Pasted images (screenshots) and files copied from the explorer become attachments; text pastes normally.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    void addAttachments(files.length, () =>
      Promise.all(
        files.map(async (file) =>
          ipc.pasteAttachment(pastedName(file), file.type, toBase64(await file.arrayBuffer())),
        ),
      ),
    );
  };

  const removeAttachment = (id: string) => setAttachments((current) => current.filter((a) => a.id !== id));

  const recallOlder = async () => {
    if (historyRef.current === null) {
      if (fetchingHistoryRef.current) return;
      fetchingHistoryRef.current = true;
      try {
        historyRef.current = await ipc.promptHistory(projectId);
      } catch {
        historyRef.current = [];
      } finally {
        fetchingHistoryRef.current = false;
      }
    }

    const list = historyRef.current;
    if (!list || list.length === 0) return;
    const nextIdx = historyIndexRef.current + 1;
    const entry = list[nextIdx];
    if (entry === undefined) return;

    if (historyIndexRef.current === -1) {
      draftRef.current = value;
    }
    historyIndexRef.current = nextIdx;
    pendingCaretEndRef.current = true;
    setValue(entry);
  };

  const recallNewer = () => {
    if (historyIndexRef.current < 0) return;
    const nextIdx = historyIndexRef.current - 1;
    historyIndexRef.current = nextIdx;
    pendingCaretEndRef.current = true;
    if (nextIdx < 0) {
      setValue(draftRef.current);
    } else {
      setValue(historyRef.current?.[nextIdx] ?? "");
    }
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    historyIndexRef.current = -1;
    setValue(e.target.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      const active = slashFiltered[slashIndex];
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // Échap closes the menu, it must not stop the agent
        setSlashDismissedAt(value);
        return;
      }
      if (active && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const n = slashFiltered.length;
        setSlashIndex((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
        return;
      }
      // Tab completes; Entrée completes too, unless the command is already fully typed (then it sends).
      if (active && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && value !== `/${active.name}`))) {
        e.preventDefault();
        pickSlash(active);
        return;
      }
    }
    // Maj+Tab: Exécuter ⇄ Planifier (as in Claude Code).
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      window.dispatchEvent(new Event(TOGGLE_PLAN_EVENT));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) {
        void sendCurrent();
      }
      return;
    }

    const el = e.currentTarget;
    if (e.key === "ArrowUp") {
      const onFirstLine =
        value.length === 0 ||
        (el.selectionStart === el.selectionEnd &&
          (el.selectionStart === 0 || value.lastIndexOf("\n", el.selectionStart - 1) === -1));
      if (onFirstLine) {
        e.preventDefault();
        void recallOlder();
      }
      return;
    }

    if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      const onLastLine =
        el.selectionStart === el.selectionEnd && value.indexOf("\n", el.selectionStart) === -1;
      if (onLastLine) {
        e.preventDefault();
        recallNewer();
      }
    }
  };

  return (
    <div className="sticky bottom-0 z-10 -mx-4 bg-linear-to-t from-background via-background/90 to-transparent px-4 pb-4 pt-6 md:-mx-6 md:px-6">
      <div className={cn("mx-auto w-full max-w-3xl", timelineGutter && "pl-10")}>
        <div className="relative">
          {slashOpen && agent && (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2">
              <SlashMenu
                commands={slashFiltered}
                query={slashQuery ?? ""}
                activeIndex={slashIndex}
                loading={slashEntry?.loading ?? true}
                providerLabel={AGENTS[agent].label}
                onPick={pickSlash}
                onHover={setSlashIndex}
              />
            </div>
          )}
          {showPill && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2">
              <NewMessagesPill onClick={onPillClick} />
            </div>
          )}
          <InputGroup className="rounded-xl bg-card shadow-sm transition-[border-color,box-shadow,background-color] duration-200 ease-snappy dark:bg-card">
            {(attachments.length > 0 || importing > 0) && (
              <InputGroupAddon align="block-start" className="p-0">
                <AttachmentTray items={attachments} pending={importing} onRemove={removeAttachment} />
              </InputGroupAddon>
            )}
            <InputGroupTextarea
              ref={textareaRef}
              data-composer
              rows={1}
              value={value}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-expanded={slashOpen}
              aria-controls={slashOpen ? "slash-menu-listbox" : undefined}
              aria-activedescendant={slashOpen && slashFiltered.length > 0 ? `slash-option-${slashIndex}` : undefined}
              aria-label="Message"
              placeholder={placeholder ?? "Demandez quelque chose à l'agent… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne, ↑ historique)"}
              className="min-h-0 max-h-[256px] overflow-y-auto px-3.5 pt-3 text-sm leading-6 field-sizing-fixed"
            />
            <InputGroupAddon align="block-end">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <InputGroupButton
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Joindre des fichiers"
                  title="Joindre des fichiers (ou coller une image)"
                  onClick={() => void pickFiles()}
                >
                  <Plus />
                </InputGroupButton>
                {toolbar ?? (threadId ? <ThreadSettingsBar threadId={threadId} /> : null)}
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {active && threadId && (
                  <InputGroupButton
                    variant="outline"
                    size="icon-sm"
                    className="rounded-full animate-in fade-in-0 zoom-in-75 duration-150"
                    aria-label="Arrêter l'agent"
                    title="Arrêter"
                    onClick={() => threadId && void useChat.getState().stop(threadId)}
                  >
                    <Square className="size-3.5 fill-current" />
                  </InputGroupButton>
                )}
                <InputGroupButton
                  variant="default"
                  size="icon-sm"
                  className="rounded-full active:scale-95"
                  aria-label="Envoyer"
                  disabled={!canSend}
                  onClick={() => void sendCurrent()}
                >
                  <ArrowUp />
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
    </div>
  );
});
