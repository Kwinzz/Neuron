import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Button } from "@/components/legacy/Button";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd } from "@/components/ui/Kbd";
import { useChat } from "@/stores/chat";
import { ToolBody } from "./ToolBody";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

export const PermissionCard = memo(function PermissionCard({
  item,
  threadId,
}: {
  item: PermissionItem;
  threadId: string;
}) {
  const [submitted, setSubmitted] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);
  const isPending = item.state === "pending";

  useEffect(() => {
    if (!isPending) return;
    // Never steal focus from a field the user is typing in: their next Enter would silently
    // approve the tool instead of sending their message.
    const focused = document.activeElement;
    if ((focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && focused.value.trim() !== "") {
      return;
    }
    allowRef.current?.focus({ preventScroll: true });
  }, [isPending]);

  const respond = (allow: boolean) => {
    if (!isPending || submitted) return;
    setSubmitted(true);
    void useChat.getState().respondPermission(threadId, item.id, allow);
    // The answered card's buttons unmount: hand focus back to the composer.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isPending || submitted) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      respond(false);
    } else if (e.key === "Enter") {
      if (e.target === e.currentTarget || e.target === allowRef.current) {
        e.preventDefault();
        e.stopPropagation();
        respond(true);
      }
    }
  };

  if (!isPending) {
    const allowed = item.state === "allowed";
    return (
      <div className="glass-tile flex items-center gap-3 rounded-xl border border-line px-4 py-2.5">
        <IconBox tone="muted" size={30}>
          <ShieldAlert size={15} strokeWidth={2} />
        </IconBox>
        <span className="shrink-0 text-sm font-bold text-fg">{item.toolName}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={item.description}>
          {item.description}
        </span>
        {allowed ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-ok">
            <Check size={14} />
            Autorisé
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-danger">
            <X size={14} />
            Refusé
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="glass-card pop-in rounded-xl border-l-2 border-warn p-5 outline-none"
    >
      <div className="flex items-start gap-3">
        <IconBox tone="warn" size={36}>
          <ShieldAlert size={17} strokeWidth={2} />
        </IconBox>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-warn">Autorisation requise</div>
          <div className="text-base font-bold text-fg">{item.toolName}</div>
          {item.description && (
            <p className="mt-1 text-sm text-fg-muted whitespace-pre-wrap select-text">{item.description}</p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <ToolBody name={item.toolName} input={item.input} output={null} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button ref={allowRef} variant="brand" disabled={submitted} onClick={() => respond(true)}>
          <Check size={15} />
          Autoriser
        </Button>
        <Button variant="ghost" disabled={submitted} onClick={() => respond(false)}>
          <X size={15} />
          Refuser
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
          <Kbd>Entrée</Kbd>
          <span>autoriser</span>
          <span>·</span>
          <Kbd>Échap</Kbd>
          <span>refuser</span>
        </div>
      </div>
    </div>
  );
});
