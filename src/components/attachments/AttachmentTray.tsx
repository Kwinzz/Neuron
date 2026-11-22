import { memo, useState } from "react";
import { X } from "lucide-react";
import type { Attachment } from "@/bindings/Attachment";
import { assetUrl } from "@/lib/ipc";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fileIcon, fileTypeLabel, formatSize } from "./fileMeta";

interface AttachmentTrayProps {
  items: Attachment[];
  pending: number;
  onRemove: (id: string) => void;
}

const AttachmentTile = memo(function AttachmentTile({
  item,
  onRemove,
}: {
  item: Attachment;
  onRemove: (id: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = item.isImage && !broken;
  const size = formatSize(item.size);

  if (showImage) {
    return (
      <div
        role="listitem"
        className="group relative size-14 shrink-0 overflow-hidden rounded-lg border bg-muted animate-in fade-in-0 zoom-in-95 duration-150"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="size-full">
              <img
                src={assetUrl(item.path)}
                alt={item.name}
                draggable={false}
                onError={() => setBroken(true)}
                className="size-full object-cover"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="flex flex-col gap-0.5">
              <span className="break-all font-medium">{item.name}</span>
              <span className="text-background/70 tabular-nums">{size}</span>
            </div>
          </TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Retirer ${item.name}`}
          className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full border bg-background/80 text-foreground opacity-0 transition-opacity duration-150 outline-none hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const Icon = fileIcon(item.name, item.mime);
  const label = fileTypeLabel(item.name, item.mime);

  return (
    <div
      role="listitem"
      className="group relative flex h-14 max-w-60 min-w-0 items-center gap-2 rounded-lg border bg-card pr-1.5 pl-2.5 animate-in fade-in-0 zoom-in-95 duration-150"
    >
      <div
        className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block max-w-[160px] truncate text-xs font-medium text-foreground">
              {item.name}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs break-all">
            {item.name}
          </TooltipContent>
        </Tooltip>
        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
          {label} · {size}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`Retirer ${item.name}`}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
});

export const AttachmentTray = memo(function AttachmentTray({
  items,
  pending,
  onRemove,
}: AttachmentTrayProps) {
  const pendingCount = Math.max(0, pending);
  if (items.length === 0 && pendingCount === 0) return null;

  return (
    <>
      <div
        role="list"
        aria-label="Pièces jointes"
        className="flex flex-wrap items-center gap-2 px-3 pt-3"
      >
        {items.map((item) => (
          <AttachmentTile key={item.id} item={item} onRemove={onRemove} />
        ))}
        {Array.from({ length: pendingCount }, (_, index) => (
          <Skeleton
            key={`pending-${index}`}
            className="size-14 shrink-0 rounded-lg"
            aria-hidden="true"
          />
        ))}
      </div>
      {/* Outside the list (only listitems allowed there); stays mounted so changes are announced. */}
      <span className="sr-only" role="status">
        {pendingCount === 0
          ? ""
          : pendingCount === 1
            ? "Import d’un fichier…"
            : `Import de ${pendingCount} fichiers…`}
      </span>
    </>
  );
});
