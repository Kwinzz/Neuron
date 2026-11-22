import { type KeyboardEvent, type RefObject, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd } from "@/components/ui/Kbd";
import { Textarea } from "@/components/ui/textarea";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { CATEGORIES } from "./categories";
import { CategoryPicker } from "./CategoryPicker";

interface MemoryComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCreated: (id: string) => void;
}

export function MemoryComposer({ textareaRef, onCreated }: MemoryComposerProps) {
  const [category, setCategory] = useState<MemoryCategory>("profile");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);

  const trimmed = content.trim();

  const submit = async () => {
    if (trimmed.length === 0 || pending) return;
    let createdId: string | null = null;
    setPending(true);
    try {
      const saved = await useMemory.getState().create(category, trimmed);
      createdId = saved.id;
      setContent("");
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible d'ajouter le souvenir",
        description: ipcErrorMessage(err),
      });
    } finally {
      setPending(false);
    }
    if (createdId !== null) {
      onCreated(createdId);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card
      size="sm"
      className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Nouveau souvenir</span>
        </CardTitle>
        <CardDescription>
          Une information durable que tous tes agents doivent connaître.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-2.5">
        <Textarea
          ref={textareaRef}
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          aria-label="Contenu du nouveau souvenir"
          placeholder={`Ex. : ${CATEGORIES[category].example}`}
          className="min-h-20 resize-none"
        />

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <CategoryPicker
            value={category}
            onChange={setCategory}
            size="sm"
            disabled={pending}
          />

          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Kbd>Entrée</Kbd>
              <span>pour ajouter</span>
              <span aria-hidden>·</span>
              <Kbd>Maj</Kbd>
              <span>+</span>
              <Kbd>Entrée</Kbd>
              <span>nouvelle ligne</span>
            </span>

            <Button
              type="button"
              size="sm"
              disabled={trimmed.length === 0 || pending}
              onClick={() => void submit()}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              <span>Ajouter</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
