import { useState } from "react";
import { cn } from "cn";
import { ClipboardPaste, FolderOpen, SquareTerminal } from "lucide-react";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";
import { CopyPromptHint } from "./CopyPromptHint";
import { IMPORT_ORIGINS, REFORMULATE_MAX_CHARS } from "./importOrigins";
import { ImportCliSources } from "./ImportCliSources";
import { ImportOriginPicker } from "./ImportOriginPicker";

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
  if (meta.web) return `Colle ici la réponse de ${meta.label}…`;
  if (origin === "other") {
    return "Écris ou colle ce que tes agents doivent savoir sur toi, un souvenir par ligne…";
  }
  return `Colle ici les instructions de ${meta.label}, ou charge-les depuis l'onglet « Fichiers des CLI »…`;
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
      toast({ tone: "danger", title: "Impossible de lire le fichier", description: ipcErrorMessage(err) });
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
            Provenance
          </Label>
          <ImportOriginPicker id="memory-import-origin" value={origin} onChange={onOriginChange} disabled={disabled} />
        </div>
        <TabsList>
          <TabsTrigger value="paste" disabled={disabled}>
            <ClipboardPaste aria-hidden />
            Coller
          </TabsTrigger>
          <TabsTrigger value="cli" disabled={disabled}>
            <SquareTerminal aria-hidden />
            Fichiers des CLI
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="paste" className="flex min-w-0 flex-col gap-3">
        {meta.web && <CopyPromptHint assistant={meta.label} />}

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={disabled}
          autoFocus
          spellCheck={false}
          aria-label="Texte à importer"
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
            <span>Ouvrir un fichier…</span>
          </Button>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {length > 0 && (
              <span className={cn("tabular-nums", tooLongForAi && "text-warn")}>
                {length.toLocaleString("fr-FR")} caractères
                {tooLongForAi && " · trop long pour la reformulation IA"}
              </span>
            )}
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <span>+</span>
              <Kbd>Entrée</Kbd>
              <span>pour continuer</span>
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
