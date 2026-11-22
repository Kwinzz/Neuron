import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/legacy/Button";
import { ipc } from "@/lib/ipc";
import { useChat } from "@/stores/chat";
import { NewMessagesPill } from "./NewMessagesPill";

const MAX_TEXTAREA_HEIGHT = 10 * 24 + 16;

interface ComposerProps {
  threadId: string;
  projectId: string | null;
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

    const ok = await useChat.getState().send(threadId, trimmed);
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
    <div className="sticky bottom-0 z-10 -mx-6 bg-linear-to-t from-bg via-bg/80 to-transparent px-6 pb-4 pt-6">
      <div className="relative mx-auto w-full max-w-[920px]">
        {showPill && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2">
            <NewMessagesPill onClick={onPillClick} />
          </div>
        )}
        <div className="glass-overlay flex items-end gap-2 rounded-xl p-2 transition-colors duration-fast focus-within:border-hl/60">
          <textarea
            ref={textareaRef}
            data-composer
            rows={1}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            aria-label="Message"
            placeholder="Demandez quelque chose à Claude… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
            className="max-h-[240px] flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
          />
          {active && (
            <Button
              variant="subtle"
              className="size-10 shrink-0 px-0! text-danger"
              aria-label="Arrêter l'agent"
              title="Arrêter"
              onClick={() => void useChat.getState().stop(threadId)}
            >
              <Square size={15} className="fill-current" />
            </Button>
          )}
          <Button
            variant="brand"
            className="size-10 shrink-0 px-0!"
            aria-label="Envoyer"
            disabled={!value.trim()}
            onClick={() => void sendCurrent()}
          >
            <ArrowUp size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
});
