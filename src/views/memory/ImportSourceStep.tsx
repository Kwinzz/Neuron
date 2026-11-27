import { useState } from "react";
import { cn } from "cn";
import { ClipboardPaste, FolderOpen, SquareTerminal } from "lucide-react";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import { Button } from "@/components/ui/button";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { CopyPromptHint } from "./CopyPromptHint";
import { IMPORT_ORIGINS, REFORMULATE_MAX_CHARS, originLabel } from "./importOrigins";
import { ImportCliSources } from "./ImportCliSources";
import { ImportOriginPicker } from "./ImportOriginPicker";
import { locale, t } from "@/i18n";

export type ImportSourceTab = "paste" | "cli";

interface ImportSourceStepProps {
  origin: MemoryImportOrigin;
  onOriginChange: (origin: MemoryImportOrigin) => void;
  tab: ImportSourceTab;
  onTabChange: (tab: ImportSourceTab) => void;
  text: string;
  onTextChange: (text: string) => void;
  disabled?: boolean;
}

function placeholderFor(origin: MemoryImportOrigin): string {
  const meta = IMPORT_ORIGINS[origin];
  if (meta.web) return t("memory.placeholderWeb", { assistant: originLabel(origin) });
  if (origin === "other") {
    return t("memory.placeholderOther");
  }
  return t("memory.placeholderCli", { assistant: originLabel(origin) });
}

export function ImportSourceStep({
  origin,
  onOriginChange,
  tab,
  onTabChange,
  text,
  onTextChange,
  disabled = false,
}: ImportSourceStepProps) {
  const [pickingFile, setPickingFile] = useState(false);
  const meta = IMPORT_ORIGINS[origin];
  const length = text.trim().length;
  const tooLongForAi = length > REFORMULATE_MAX_CHARS;

  const handleOpenFile = async () => {
    if (pickingFile) return;
    setPickingFile(true);
    try {
      const path = await ipc.pickImportFile();
      if (path !== null) onTextChange(await ipc.readMemoryImportFile(path));
    } catch (err: unknown) {
      toast({ tone: "danger", title: t("memory.readFileFailed"), description: ipcErrorMessage(err) });
    } finally {
      setPickingFile(false);
    }
  };

  const handleUseCliFile = (fileOrigin: MemoryImportOrigin, content: string) => {
    onOriginChange(fileOrigin);
    onTextChange(content);
    onTabChange("paste");
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        if (next === "paste" || next === "cli") onTabChange(next);
      }}
      className="min-w-0 gap-4"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Label htmlFor="memory-import-origin" className="text-muted-foreground">
            {t("memory.originLabel")}
          </Label>
          <ImportOriginPicker id="memory-import-origin" value={origin} onChange={onOriginChange} disabled={disabled} />
        </div>
        <TabsList>
          <TabsTrigger value="paste" disabled={disabled}>
            <ClipboardPaste aria-hidden />
            {t("memory.tabPaste")}
          </TabsTrigger>
          <TabsTrigger value="cli" disabled={disabled}>
            <SquareTerminal aria-hidden />
            {t("memory.tabCliFiles")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="paste" className="flex min-w-0 flex-col gap-3">
        {meta.web && <CopyPromptHint assistant={originLabel(origin)} />}

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={disabled}
          autoFocus
          spellCheck={false}
          aria-label={t("memory.textToImport")}
          placeholder={placeholderFor(origin)}
          className="max-h-[42vh] min-h-56 resize-none font-mono text-xs leading-relaxed md:text-xs"
        />

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || pickingFile}
            onClick={() => void handleOpenFile()}
          >
            <FolderOpen aria-hidden />
            <span>{t("memory.openFile")}</span>
          </Button>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {length > 0 && (
              <span className={cn("tabular-nums", tooLongForAi && "text-warn")}>
                {t("memory.chars", { n: length.toLocaleString(locale()) })}
                {tooLongForAi && ` · ${t("memory.tooLongForAi")}`}
              </span>
            )}
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>{MOD_LABEL}</Kbd>
              <span>+</span>
              <Kbd>{t("memory.keyEnter")}</Kbd>
              <span>{t("memory.toContinue")}</span>
            </span>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="cli" className="min-w-0">
        <ImportCliSources onUse={handleUseCliFile} />
      </TabsContent>
    </Tabs>
  );
}
