import {
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Columns2,
  Eye,
  FileText,
  Info,
  Layers,
  PencilLine,
  Save,
  Undo2,
} from "lucide-react";
import type { ContextBundle } from "@/bindings/ContextBundle";
import type { ProjectContextFile } from "@/bindings/ProjectContextFile";
import { ContextBundleView } from "@/components/context/ContextBundleView";
import { Markdown } from "@/components/markdown/Markdown";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";

type EditorViewMode = "edit" | "split" | "preview";

interface ContextEditorProps {
  projectId: string;
  file: ProjectContextFile | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  preview: ContextBundle | undefined;
  previewLoading: boolean;
  onSaved: () => void;
}

export function ContextEditor({
  projectId,
  file,
  loading,
  error,
  onRetry,
  preview,
  previewLoading,
  onSaved,
}: ContextEditorProps) {
  const [syncedFile, setSyncedFile] = useState<ProjectContextFile | null>(file);
  const [savedContent, setSavedContent] = useState(file?.content ?? "");
  const [draft, setDraft] = useState(file?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [viewMode, setViewMode] = useState<EditorViewMode>("split");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const escapeTabRef = useRef(false);
  const savedTimerRef = useRef<number | null>(null);

  if (syncedFile !== file) {
    setSyncedFile(file);
    setSavedContent(file?.content ?? "");
    setDraft(file?.content ?? "");
    setJustSaved(false);
  }

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearSavedTimer();
  }, [file, clearSavedTimer]);

  useEffect(() => () => clearSavedTimer(), [clearSavedTimer]);

  const dirty = file !== null && draft !== savedContent;
  const deferredDraft = useDeferredValue(draft);

  const renderedPreview = useMemo(
    () => <Markdown doc>{deferredDraft}</Markdown>,
    [deferredDraft],
  );

  const updateDraft = useCallback(
    (next: string) => {
      setDraft(next);
      setJustSaved(false);
      clearSavedTimer();
    },
    [clearSavedTimer],
  );

  const handleDraftChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    updateDraft(e.target.value);
  };

  const save = useCallback(async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    setJustSaved(false);
    clearSavedTimer();
    const contentToSave = draft;
    try {
      await ipc.saveProjectContext(projectId, contentToSave);
      setSavedContent(contentToSave);
      setJustSaved(true);
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null;
        setJustSaved(false);
      }, 2000);
      onSaved();
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("project.saveFailed"),
        description: ipcErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  }, [clearSavedTimer, dirty, draft, file, onSaved, projectId, saving]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      escapeTabRef.current = true;
      return;
    }

    if (e.key === "Tab") {
      if (escapeTabRef.current || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
        escapeTabRef.current = false;
        return;
      }

      e.preventDefault();
      const inserted = document.execCommand("insertText", false, "  ");
      if (!inserted) {
        const el = e.currentTarget;
        el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
        updateDraft(el.value);
      }
      return;
    }

    escapeTabRef.current = false;
  };

  const handleEditorScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (viewMode !== "split") return;
    const previewEl = previewRef.current;
    if (!previewEl) return;

    const editorEl = e.currentTarget;
    const maxEditor = editorEl.scrollHeight - editorEl.clientHeight;
    if (maxEditor <= 0) return;

    const maxPreview = previewEl.scrollHeight - previewEl.clientHeight;
    if (maxPreview <= 0) return;

    previewEl.scrollTop = (editorEl.scrollTop / maxEditor) * maxPreview;
  };

  if (loading && !file) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="@container overflow-hidden rounded-xl border bg-card">
          <div className="flex h-11 items-center justify-between gap-2 border-b px-3">
            <Skeleton className="h-4 w-56 max-w-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-7 w-24" />
            </div>
          </div>
          <div className="grid @3xl:grid-cols-2">
            <div className="h-[clamp(22rem,62vh,44rem)] p-4">
              <Skeleton className="h-full w-full rounded-lg" />
            </div>
            <div className="h-[clamp(22rem,62vh,44rem)] border-t p-4 @3xl:border-t-0 @3xl:border-l">
              <Skeleton className="h-full w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !file) {
    return (
      <Alert
        variant="destructive"
        className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 has-data-[slot=alert-action]:pr-28"
      >
        <AlertCircle aria-hidden />
        <AlertTitle>{t("project.readFailed")}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (!file) {
    return null;
  }

  const lineCount = draft.length === 0 ? 0 : draft.split("\n").length;
  const charCount = draft.length;
  const previewSourceCount = preview?.sources.length ?? 0;
  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex min-w-0 flex-col gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      {file.created && (
        <Alert className="animate-in fade-in-0 duration-150">
          <Info aria-hidden />
          <AlertTitle>{t("project.createdFromTemplate")}</AlertTitle>
          <AlertDescription>
            {t("project.createdFromTemplateBody")}
          </AlertDescription>
        </Alert>
      )}

      <div className="@container overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="min-w-0 truncate rounded-sm font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {file.path}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-md font-mono wrap-anywhere">
                  {file.path}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex shrink-0 items-center text-xs" aria-live="polite">
              {saving ? (
                <span className="text-muted-foreground">{t("project.saving")}</span>
              ) : dirty ? (
                <span className="inline-flex items-center gap-1.5 text-warn">
                  <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                  <span>{t("project.unsaved")}</span>
                </span>
              ) : (
                <span
                  aria-hidden={!justSaved}
                  className={cn(
                    "inline-flex items-center gap-1 text-muted-foreground transition-opacity duration-150",
                    justSaved ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                >
                  <Check className="size-3.5 text-ok" aria-hidden />
                  <span>{t("project.saved")}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              value={viewMode}
              onValueChange={(value) => {
                if (value === "edit" || value === "split" || value === "preview") {
                  setViewMode(value);
                }
              }}
            >
              <ToggleGroupItem value="edit" aria-label={t("project.modeEdit")}>
                <PencilLine aria-hidden />
                <span className="hidden @md:inline">{t("project.modeEdit")}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="split" aria-label={t("project.modeSplit")}>
                <Columns2 aria-hidden />
                <span className="hidden @md:inline">{t("project.modeSplit")}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="preview" aria-label={t("project.modePreview")}>
                <Eye aria-hidden />
                <span className="hidden @md:inline">{t("project.modePreview")}</span>
              </ToggleGroupItem>
            </ToggleGroup>

            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || saving}
              aria-label={t("project.revertChanges")}
              onClick={() => updateDraft(savedContent)}
            >
              <Undo2 aria-hidden />
              <span>{t("common.cancel")}</span>
            </Button>

            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              <Save aria-hidden />
              <span>{t("common.save")}</span>
              <Kbd className="ml-1 border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground">
                {MOD_LABEL} S
              </Kbd>
            </Button>
          </div>
        </div>

        <div className={cn("grid", viewMode === "split" && "@3xl:grid-cols-2")}>
          {showEditor && (
            <div className="flex min-w-0 flex-col">
              <div className="flex h-9 items-center justify-between gap-2 border-b px-3">
                <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  Markdown
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {t("project.editorStats", { lines: lineCount, chars: charCount })}
                </span>
              </div>
              <div className="h-[clamp(22rem,62vh,44rem)] focus-within:ring-2 focus-within:ring-ring/50 focus-within:ring-inset">
                <textarea
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={handleTextareaKeyDown}
                  onFocus={() => {
                    escapeTabRef.current = false;
                  }}
                  onScroll={handleEditorScroll}
                  spellCheck={false}
                  aria-label={t("project.editorAria")}
                  placeholder={t("project.editorPlaceholder")}
                  className="size-full resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground selection:bg-accent"
                />
              </div>
            </div>
          )}

          {showPreview && (
            <div
              className={cn(
                "flex min-w-0 flex-col",
                viewMode === "split" && "border-t @3xl:border-t-0 @3xl:border-l",
              )}
            >
              <div className="flex h-9 items-center justify-between gap-2 border-b px-3">
                <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  {t("project.modePreview")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("project.liveRender")}
                </span>
              </div>
              <div ref={previewRef} className="h-[clamp(22rem,62vh,44rem)] overflow-y-auto p-4">
                {deferredDraft.trim().length > 0 ? (
                  renderedPreview
                ) : (
                  <p className="text-sm text-muted-foreground">{t("project.previewEmpty")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Collapsible className="rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group flex h-auto w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {t("project.newChatReceives")}
                </span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {t("project.newChatReceivesHint")}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {preview && (
                <span className="font-mono tabular-nums">
                  {t("project.sourceCount", { n: previewSourceCount })}
                </span>
              )}
              <ChevronDown
                className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </span>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t p-4 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150">
          {previewLoading && !preview ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : !preview ? (
            <p className="text-xs text-muted-foreground">{t("project.previewUnavailable")}</p>
          ) : (
            <ContextBundleView bundle={preview} size="sm" className="max-h-[480px]" />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
