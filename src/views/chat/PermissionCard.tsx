import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
        <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground">{item.toolName}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={item.description}>
          {item.description}
        </span>
        {allowed ? (
          <Badge variant="outline" className="shrink-0 border-ok/30 text-ok">
            <Check />
            Autorisé
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 border-destructive/30 text-destructive">
            <X />
            Refusé
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Alert
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="border-warn/50 px-4 py-3 outline-none"
    >
      <ShieldAlert className="text-warn" />
      <AlertTitle className="font-semibold text-foreground">
        Autorisation requise — {item.toolName}
      </AlertTitle>
      {item.description && (
        <AlertDescription className="col-start-2 whitespace-pre-wrap select-text">
          {item.description}
        </AlertDescription>
      )}
      <div className="col-start-2 mt-2">
        <ToolBody name={item.toolName} input={item.input} output={null} />
      </div>
      <div className="col-start-2 mt-3 flex flex-wrap items-center gap-2">
        <Button ref={allowRef} size="sm" disabled={submitted} onClick={() => respond(true)}>
          <Check />
          Autoriser
        </Button>
        <Button variant="outline" size="sm" disabled={submitted} onClick={() => respond(false)}>
          <X />
          Refuser
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Kbd>Entrée</Kbd>
          <span>autoriser</span>
          <span>·</span>
          <Kbd>Échap</Kbd>
          <span>refuser</span>
        </div>
      </div>
    </Alert>
  );
});
