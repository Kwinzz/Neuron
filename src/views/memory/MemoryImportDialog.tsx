import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { ImportedMemory } from "@/bindings/ImportedMemory";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { type ImportRow, normalizeMemory, toImportRows } from "./importOrigins";
import { ImportPreviewStep } from "./ImportPreviewStep";
import { ImportReformulate } from "./ImportReformulate";
import { ImportSourceStep, type ImportSourceTab } from "./ImportSourceStep";
import { locale, t } from "@/i18n";

interface MemoryImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Import saved: the parent closes the dialog and resets it. */
  onImported: () => void;
}

type Step = "source" | "preview";

/** Vars of the « N souvenir(s) » messages: raw number for the plural, formatted one for display. */
function countVars(n: number): { n: number; count: string } {
  return { n, count: n.toLocaleString(locale()) };
}

export function MemoryImportDialog({ open, onOpenChange, onImported }: MemoryImportDialogProps) {
  const items = useMemory((s) => s.items);
  const existing = useMemo(() => new Set(items.map((m) => normalizeMemory(m.content))), [items]);

  const [step, setStep] = useState<Step>("source");
  const [origin, setOrigin] = useState<MemoryImportOrigin>("claude_ai");
  const [tab, setTab] = useState<ImportSourceTab>("paste");
  const [text, setText] = useState("");

  /** Text the preview was built from (sent as is to the reformulation). */
  const [previewText, setPreviewText] = useState("");
  const [rawItems, setRawItems] = useState<ImportedMemory[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [reformulated, setReformulated] = useState(false);

  const [agent, setAgent] = useState<AgentKind | null>(null);
  const [reformulatingSince, setReformulatingSince] = useState<number | null>(null);
  const [reformulateError, setReformulateError] = useState<string | null>(null);

  const [splitting, setSplitting] = useState(false);
  const [importing, setImporting] = useState(false);

  /** Bumped whenever the preview is rebuilt: a reformulation still running for an older one is ignored. */
  const requestRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const reformulating = reformulatingSince !== null;
  const toImport = rows.filter((row) => row.checked && row.content.trim().length > 0);
  const canNext = text.trim().length > 0 && !splitting;
  const canImport = toImport.length > 0 && !importing && !reformulating;

  const goToPreview = async () => {
    if (!canNext) return;
    // Back then forward on the same text: keep the edits made in the preview.
    if (text === previewText && rows.length > 0) {
      setStep("preview");
      return;
    }
    setSplitting(true);
    try {
      const split = await ipc.splitMemoryImport(text);
      if (split.length === 0) {
        toast({ tone: "warn", title: t("memory.noneFound") });
        return;
      }
      requestRef.current += 1;
      setRawItems(split);
      setRows(toImportRows(split, existing));
      setPreviewText(text);
      setReformulated(false);
      setReformulatingSince(null);
      setReformulateError(null);
      setStep("preview");
    } catch (err: unknown) {
      toast({ tone: "danger", title: t("memory.splitFailed"), description: ipcErrorMessage(err) });
    } finally {
      setSplitting(false);
    }
  };

  const handleReformulate = async (chosen: AgentKind) => {
    if (reformulating) return;
    setAgent(chosen);
    const request = ++requestRef.current;
    setReformulatingSince(Date.now());
    setReformulateError(null);
    try {
      const rewritten = await ipc.reformulateMemoryImport(chosen, previewText);
      if (request !== requestRef.current) return;
      if (rewritten.length === 0) {
        setReformulateError(t("memory.agentReturnedNone"));
        return;
      }
      setRows(toImportRows(rewritten, existing));
      setReformulated(true);
    } catch (err: unknown) {
      if (request === requestRef.current) setReformulateError(ipcErrorMessage(err));
    } finally {
      if (request === requestRef.current) setReformulatingSince(null);
    }
  };

  const handleRevert = () => {
    requestRef.current += 1;
    setRows(toImportRows(rawItems, existing));
    setReformulated(false);
    setReformulateError(null);
  };

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    try {
      const added = await ipc.importMemories(
        toImport.map((row) => ({ category: row.category, content: row.content.trim() })),
        origin,
      );
      if (added === 0) {
        toast({ tone: "info", title: t("memory.nothingNew") });
      } else {
        toast({ tone: "ok", title: t("memory.importedToast", countVars(added)) });
      }
      void useMemory.getState().load();
      onImported();
    } catch (err: unknown) {
      toast({ tone: "danger", title: t("memory.importFailed"), description: ipcErrorMessage(err) });
    } finally {
      setImporting(false);
    }
  };

  const handleRowChange = useCallback((id: number, patch: Partial<Omit<ImportRow, "id">>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const handleRowRemove = useCallback((id: number) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const handleToggleAll = useCallback((checked: boolean) => {
    setRows((prev) => prev.map((row) => (row.checked === checked ? row : { ...row, checked })));
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (step === "source") void goToPreview();
    else void handleImport();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!importing) onOpenChange(next);
      }}
    >
      <DialogContent
        ref={contentRef}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(e) => {
          const textarea = contentRef.current?.querySelector("textarea");
          if (textarea) {
            e.preventDefault();
            textarea.focus();
          }
        }}
        className="flex max-h-[min(88vh,56rem)] flex-col gap-4 sm:max-w-2xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t("memory.importTitle")}
          </DialogTitle>
          <DialogDescription>
            {step === "source"
              ? t("memory.importSourceDescription")
              : t("memory.importPreviewDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          {step === "source" ? (
            <ImportSourceStep
              origin={origin}
              onOriginChange={setOrigin}
              tab={tab}
              onTabChange={setTab}
              text={text}
              onTextChange={setText}
              disabled={splitting}
            />
          ) : (
            <ImportPreviewStep
              rows={rows}
              existing={existing}
              disabled={importing || reformulating}
              onChange={handleRowChange}
              onRemove={handleRowRemove}
              onToggleAll={handleToggleAll}
              reformulate={
                <ImportReformulate
                  agent={agent}
                  onAgentChange={setAgent}
                  runningSince={reformulatingSince}
                  error={reformulateError}
                  reformulated={reformulated}
                  textLength={previewText.trim().length}
                  disabled={importing}
                  onReformulate={(chosen) => void handleReformulate(chosen)}
                  onRevert={handleRevert}
                />
              }
            />
          )}
        </div>

        <DialogFooter>
          {step === "source" ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!canNext} onClick={() => void goToPreview()}>
                <span>{t("common.next")}</span>
                <ArrowRight data-icon="inline-end" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={importing} onClick={() => setStep("source")}>
                <ArrowLeft data-icon="inline-start" aria-hidden />
                <span>{t("common.back")}</span>
              </Button>
              <Button type="button" disabled={!canImport} onClick={() => void handleImport()}>
                <Download data-icon="inline-start" aria-hidden />
                <span>
                  {toImport.length === 0
                    ? t("memory.import")
                    : t("memory.importCount", countVars(toImport.length))}
                </span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
