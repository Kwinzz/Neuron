import { memo } from "react";
import { cn } from "cn";
import { X } from "lucide-react";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CategoryPicker } from "./CategoryPicker";
import { ImportCheckbox } from "./ImportCheckbox";
import type { ImportRow } from "./importOrigins";

interface ImportPreviewRowProps {
  row: ImportRow;
  index: number;
  /** Same content already in the global memory. */
  duplicate: boolean;
  disabled: boolean;
  onChange: (id: number, patch: Partial<Omit<ImportRow, "id">>) => void;
  onRemove: (id: number) => void;
}

export const ImportPreviewRow = memo(function ImportPreviewRow({
  row,
  index,
  duplicate,
  disabled,
  onChange,
  onRemove,
}: ImportPreviewRowProps) {
  const empty = row.content.trim().length === 0;

  return (
    <li
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg border p-2.5 transition-opacity duration-150",
        !row.checked && "opacity-60 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <ImportCheckbox
        checked={row.checked}
        onCheckedChange={(checked) => onChange(row.id, { checked })}
        label={`Importer le souvenir ${index + 1}`}
        disabled={disabled}
        className="mt-2"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          rows={1}
          value={row.content}
          onChange={(e) => onChange(row.id, { content: e.target.value })}
          disabled={disabled}
          aria-label={`Contenu du souvenir ${index + 1}`}
          aria-invalid={empty || undefined}
          placeholder="Souvenir vide : il ne sera pas importé"
          className="min-h-8 resize-none py-1.5"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CategoryPicker
            value={row.category}
            onChange={(category: MemoryCategory) => onChange(row.id, { category })}
            size="xs"
            disabled={disabled}
          />
          {duplicate && (
            <Badge variant="outline" className="text-muted-foreground">
              Déjà en mémoire
            </Badge>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={() => onRemove(row.id)}
        aria-label={`Retirer le souvenir ${index + 1}`}
        className="mt-1 text-muted-foreground"
      >
        <X aria-hidden />
      </Button>
    </li>
  );
});
