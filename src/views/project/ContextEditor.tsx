import {
  type ComponentProps,
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  FileText,
  Info,
  Layers,
  Save,
  Undo2,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContextBundle } from "@/bindings/ContextBundle";
import type { ProjectContextFile } from "@/bindings/ProjectContextFile";
import { ContextMarkdown } from "@/components/context/ContextMarkdown";
import { SourceBadge } from "@/components/context/SourceBadge";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import "@/views/chat/chat.css";

type MarkdownProps = ComponentProps<typeof ReactMarkdown>;

const REMARK: MarkdownProps["remarkPlugins"] = [remarkGfm];

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

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

  if (syncedFile !== file) {
    setSyncedFile(file);
    setSavedContent(file?.content ?? "");
    setDraft(file?.content ?? "");
  }

  const dirty = file !== null && draft !== savedContent;
  const deferredDraft = useDeferredValue(draft);

  const renderedPreview = useMemo(
    () => (
      <div className="chat-prose select-text text-sm leading-6 text-foreground">
        <ReactMarkdown remarkPlugins={REMARK} components={COMPONENTS}>
          {deferredDraft}
        </ReactMarkdown>
      </div>
    ),
    [deferredDraft],
  );

  const save = useCallback(async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    const contentToSave = draft;
    try {
      await ipc.saveProjectContext(projectId, contentToSave);
      setSavedContent(contentToSave);
      toast({ tone: "ok", title: "context.md enregistré" });
      onSaved();
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Échec de l'enregistrement",
        description: ipcErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, file, onSaved, projectId, saving]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  if (loading && !file) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-28" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-[420px] w-full rounded-lg" />
          <Skeleton className="h-[420px] w-full rounded-lg" />
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
        <AlertTitle>Impossible de lire context.md</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline" onClick={onRetry}>
            Réessayer
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (!file) {
    return null;
  }

  const previewSourceCount = preview?.sources.length ?? 0;

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex min-w-0 flex-col gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex max-w-full min-w-0 flex-1 basis-48 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="min-w-0 truncate font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 focus-visible:text-foreground"
              >
                {file.path}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md font-mono wrap-anywhere">{file.path}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-xs text-warn animate-in fade-in-0 duration-150">
              <span className="size-1.5 rounded-full bg-warn" aria-hidden />
              <span>Modifications non enregistrées</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => setDraft(savedContent)}
          >
            <Undo2 aria-hidden />
            <span>Annuler les modifications</span>
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            <Save aria-hidden />
            <span>{saving ? "Enregistrement…" : "Enregistrer"}</span>
            {!saving && (
              <Kbd className="ml-1 border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground">
                {MOD_LABEL} S
              </Kbd>
            )}
          </Button>
        </div>
      </div>

      {file.created && (
        <Alert className="animate-in fade-in-0 duration-150">
          <Info aria-hidden />
          <AlertTitle>Fichier créé à partir du modèle</AlertTitle>
          <AlertDescription>
            Complète-le : il sera injecté dans chaque nouveau chat de ce projet.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Markdown
          </span>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Contenu de context.md"
            className="min-h-[420px] resize-y font-mono text-[13px] leading-6"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Aperçu
          </span>
          <div className="min-h-[420px] min-w-0 overflow-auto rounded-lg border bg-card p-4">
            {deferredDraft.trim().length > 0 ? (
              renderedPreview
            ) : (
              <p className="text-sm text-muted-foreground">Aucun contenu à prévisualiser.</p>
            )}
          </div>
        </div>
      </div>

      <Collapsible className="rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group flex h-auto w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">Ce que recevra un nouveau chat</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {preview && (
                <span className="font-mono tabular-nums">
                  {previewSourceCount} {previewSourceCount <= 1 ? "source" : "sources"}
                </span>
              )}
              <ChevronDown
                className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </span>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t p-3.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150">
          {previewLoading && !preview ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : !preview ? (
            <p className="text-xs text-muted-foreground">Aperçu indisponible.</p>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              {preview.sources.length > 0 && (
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {preview.sources.map((source, index) => (
                    <SourceBadge key={`${source.kind}-${source.label}-${index}`} source={source} />
                  ))}
                </div>
              )}
              <ContextMarkdown markdown={preview.markdown} className="max-h-[480px]" />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
