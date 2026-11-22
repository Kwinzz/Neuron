import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useEffect,
  useLayoutEffect,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ThreadSettingsBar } from "@/components/chat/ThreadSettingsBar";
import { ipc } from "@/lib/ipc";
import { useChat } from "@/stores/chat";
import { NewMessagesPill } from "./NewMessagesPill";

const MAX_TEXTAREA_HEIGHT = 10 * 24 + 16;

interface ComposerProps {
  /** null = draft chat (not created yet): `submit` handles the first message. */
  threadId: string | null;
  projectId: string | null;
  /** Custom submit (draft chat). Resolve true when the message was accepted. */
  submit?: (text: string) => Promise<boolean>;
  /** Left side of the bottom bar. Defaults to the chat's model / effort / permission selectors. */
  toolbar?: ReactNode;
  placeholder?: string;
  active: boolean;
  onSent: () => void;
  /** Show the floating "Nouveaux messages" pill above the input. */
  showPill: boolean;
  onPillClick: () => void;
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
}: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const sendCurrent = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const previous = value;
    setValue("");
    historyIndexRef.current = -1;
    draftRef.current = "";
    onSent();

    const ok = submit
      ? await submit(trimmed)
      : threadId
        ? await useChat.getState().send(threadId, trimmed)
        : false;
    if (!ok) {
      setValue((current) => (current === "" ? previous : current));
      return;
    }

    if (historyRef.current !== null && historyRef.current[0] !== trimmed) {
      historyRef.current = [trimmed, ...historyRef.current];
    }
  };

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
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim()) {
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
      <div className="relative mx-auto w-full max-w-3xl">
        {showPill && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2">
            <NewMessagesPill onClick={onPillClick} />
          </div>
        )}
        <InputGroup className="rounded-xl bg-card shadow-sm transition-[border-color,box-shadow,background-color] duration-200 ease-snappy dark:bg-card">
          <InputGroupTextarea
            ref={textareaRef}
            data-composer
            rows={1}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            aria-label="Message"
            placeholder={placeholder ?? "Demandez quelque chose à l'agent… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne, ↑ historique)"}
            className="min-h-0 max-h-[256px] overflow-y-auto px-3.5 pt-3 text-sm leading-6 field-sizing-fixed"
          />
          <InputGroupAddon align="block-end">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
                disabled={!value.trim()}
                onClick={() => void sendCurrent()}
              >
                <ArrowUp />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
});
