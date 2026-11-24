import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { ImportCheckbox } from "./ImportCheckbox";
import { type ImportRow, normalizeMemory } from "./importOrigins";
import { ImportPreviewRow } from "./ImportPreviewRow";

interface ImportPreviewStepProps {
  rows: readonly ImportRow[];
  /** Normalised contents of the memories already saved. */
  existing: ReadonlySet<string>;
  disabled: boolean;
  /** « Reformuler avec l'IA » block. */
  reformulate: ReactNode;
  onChange: (id: number, patch: Partial<Omit<ImportRow, "id">>) => void;
  onRemove: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;
}

export function ImportPreviewStep({
  rows,
  existing,
  disabled,
  reformulate,
  onChange,
  onRemove,
  onToggleAll,
}: ImportPreviewStepProps) {
  const duplicates = rows.map((row) => existing.has(normalizeMemory(row.content)));
  const duplicateCount = duplicates.filter(Boolean).length;
  const checkedCount = rows.filter((row) => row.checked).length;
  const allState = checkedCount === 0 ? false : checkedCount === rows.length ? true : "mixed";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {reformulate}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <Inbox className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Plus aucun souvenir à importer</p>
          <p className="text-xs text-muted-foreground">Reviens au texte pour le modifier, ou reformule-le avec l'IA.</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2.5 px-2.5 text-sm">
            <ImportCheckbox
              checked={allState}
              onCheckedChange={onToggleAll}
              label="Tout sélectionner"
              disabled={disabled}
            />
            <span className="tabular-nums">
              {plural(rows.length, "souvenir", "souvenirs")}
              {duplicateCount > 0 && (
                <span className="text-muted-foreground"> · {duplicateCount.toLocaleString("fr-FR")} déjà en mémoire</span>
              )}
            </span>
          </div>

          <ul className="flex min-w-0 flex-col gap-2">
            {rows.map((row, index) => (
              <ImportPreviewRow
                key={row.id}
                row={row}
                index={index}
                duplicate={duplicates[index] ?? false}
                disabled={disabled}
                onChange={onChange}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
