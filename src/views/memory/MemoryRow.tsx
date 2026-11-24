import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import type { Memory } from "@/bindings/Memory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { categoryMeta as getCategoryMeta } from "./categories";
import { CategoryPicker } from "./CategoryPicker";
import { HighlightedText } from "./HighlightedText";
import { MemoryDeleteDialog } from "./MemoryDeleteDialog";
import { MemorySource } from "./MemorySource";
import { MemoryTime } from "./MemoryTime";
import { t } from "@/i18n";

interface MemoryRowProps {
  memory: Memory;
  index: number;
  highlighted: boolean;
  query?: string;
  showCategory?: boolean;
}

export const MemoryRow = memo(function MemoryRow({
  memory,
  index,
  highlighted,
  query,
  showCategory = false,
}: MemoryRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>(memory.category);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editing]);

  const startEdit = () => {
    setDraft(memory.content);
    setDraftCategory(memory.category);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (saving) return;
    setEditing(false);
    setDraft(memory.content);
    setDraftCategory(memory.category);
  };

  const trimmedDraft = draft.trim();
  const canSave =
    trimmedDraft.length > 0 &&
    (trimmedDraft !== memory.content || draftCategory !== memory.category);

  const saveEdit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await useMemory.getState().update(memory.id, draftCategory, trimmedDraft);
      setEditing(false);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("memory.saveFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
      return;
    }
    if (!e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void saveEdit();
    }
  };

  const categoryMeta = getCategoryMeta(memory.category);
  const CategoryIcon = categoryMeta.icon;
  const activeQuery = query?.trim() ?? "";

  return (
    <>
      <li
        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
        className={cn(
          "group relative flex min-w-0 gap-3 rounded-lg px-3 py-2.5 transition-[color,background-color,opacity,transform] duration-150 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both hover:bg-accent/50 focus-within:bg-accent/50",
          highlighted && "bg-accent",
        )}
      >
        {editing ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Textarea
              ref={editRef}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              disabled={saving}
              aria-label={t("memory.editAria")}
              className="min-h-20 resize-none"
            />

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <CategoryPicker
                value={draftCategory}
                onChange={setDraftCategory}
                size="xs"
                disabled={saving}
              />

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                  <Kbd>{MOD_LABEL}</Kbd>
                  <span>+</span>
                  <Kbd>{t("memory.keyEnter")}</Kbd>
                  <span>{t("memory.hintSave")}</span>
                  <span aria-hidden>·</span>
                  <Kbd>{t("memory.keyEscape")}</Kbd>
                  <span>{t("memory.hintCancel")}</span>
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={saving}
                  onClick={cancelEdit}
                >
                  {t("common.cancel")}
                </Button>

                <Button
                  type="button"
                  size="xs"
                  disabled={!canSave || saving}
                  onClick={() => void saveEdit()}
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  <span>{t("common.save")}</span>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere text-foreground">
                {activeQuery.length > 0 ? (
                  <HighlightedText text={memory.content} query={activeQuery} />
                ) : (
                  memory.content
                )}
              </p>

              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {showCategory && (
                  <Badge variant="outline" className="gap-1 font-normal">
                    <CategoryIcon
                      className={cn("shrink-0", categoryMeta.iconClass)}
                      aria-hidden
                    />
                    <span>{categoryMeta.short}</span>
                  </Badge>
                )}
                <MemorySource source={memory.source} />
                <span aria-hidden>·</span>
                <MemoryTime ts={memory.updatedAt} />
              </div>
            </div>

            <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("common.edit")}
                    onClick={startEdit}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.edit")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("common.delete")}
                    onClick={() => setDeleteOpen(true)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.delete")}</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </li>

      <MemoryDeleteDialog
        memory={memory}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
});
