import {
  memo,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Attachment } from "@/bindings/Attachment";
import { assetUrl } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fileIcon, fileTypeLabel, formatSize } from "./fileMeta";
import { t } from "@/i18n";

interface MessageAttachmentsProps {
  items: Attachment[];
  align?: "start" | "end";
}

const MessageImageThumb = memo(function MessageImageThumb({
  item,
  index,
  single,
  onOpen,
  onBroken,
}: {
  item: Attachment;
  index: number;
  single: boolean;
  onOpen: (index: number) => void;
  onBroken: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      aria-label={t("chat.enlargeImage", { name: item.name })}
      className="block cursor-pointer overflow-hidden rounded-lg outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src={assetUrl(item.path)}
        alt={item.name}
        draggable={false}
        onError={() => onBroken(item.id)}
        className={cn(
          "block rounded-lg border bg-muted object-cover",
          single ? "h-auto max-h-40 w-auto max-w-[280px]" : "size-[120px]",
        )}
      />
    </button>
  );
});

const MessageFileChip = memo(function MessageFileChip({
  item,
}: {
  item: Attachment;
}) {
  const Icon = fileIcon(item.name, item.mime);
  const label = fileTypeLabel(item.name, item.mime);
  const size = formatSize(item.size);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="flex h-11 max-w-64 min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {item.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
              {label} · {size}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs break-all">
        {item.name}
      </TooltipContent>
    </Tooltip>
  );
});

export const MessageAttachments = memo(function MessageAttachments({
  items,
  align = "end",
}: MessageAttachmentsProps) {
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Index survives closing so the exit animation keeps showing the image.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const { images, files } = useMemo(() => {
    const imgs: Attachment[] = [];
    const rest: Attachment[] = [];
    for (const item of items) {
      if (item.isImage && !brokenIds.has(item.id)) {
        imgs.push(item);
      } else {
        rest.push(item);
      }
    }
    return { images: imgs, files: rest };
  }, [items, brokenIds]);

  const markBroken = useCallback((id: string) => {
    setBrokenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setLightboxOpen(false);
  }, []);

  const imageCount = images.length;

  const goPrev = useCallback(() => {
    if (imageCount <= 1) return;
    setLightboxIndex((prev) =>
      prev === null ? 0 : (prev - 1 + imageCount) % imageCount,
    );
  }, [imageCount]);

  const goNext = useCallback(() => {
    if (imageCount <= 1) return;
    setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % imageCount));
  }, [imageCount]);

  const handleLightboxKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (imageCount <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    },
    [imageCount, goPrev, goNext],
  );

  if (items.length === 0) return null;

  const safeIndex =
    lightboxIndex !== null && imageCount > 0
      ? Math.min(lightboxIndex, imageCount - 1)
      : null;
  const activeImage = safeIndex !== null ? (images[safeIndex] ?? null) : null;

  const rowJustify = align === "end" ? "justify-end" : "justify-start";

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        align === "end" ? "items-end" : "items-start",
      )}
    >
      {imageCount > 0 && (
        <div className={cn("flex flex-wrap gap-2", rowJustify)}>
          {images.map((item, index) => (
            <MessageImageThumb
              key={item.id}
              item={item}
              index={index}
              single={imageCount === 1}
              onOpen={openLightbox}
              onBroken={markBroken}
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className={cn("flex flex-wrap gap-2", rowJustify)}>
          {files.map((item) => (
            <MessageFileChip key={item.id} item={item} />
          ))}
        </div>
      )}

      <Dialog
        open={lightboxOpen && activeImage !== null}
        onOpenChange={handleOpenChange}
      >
        <DialogContent
          showCloseButton={false}
          onKeyDown={handleLightboxKeyDown}
          className="flex w-auto max-w-[90vw] min-w-[min(20rem,90vw)] flex-col gap-0 overflow-hidden bg-popover p-0 sm:max-w-[90vw]"
        >
          {activeImage && (
            <>
              <img
                src={assetUrl(activeImage.path)}
                alt={activeImage.name}
                draggable={false}
                onError={() => markBroken(activeImage.id)}
                className="mx-auto block h-auto max-h-[85vh] w-auto max-w-[90vw] object-contain"
              />
              <div className="flex w-0 min-w-full items-center gap-3 border-t py-2 pr-2 pl-4 text-sm">
                <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
                  {activeImage.name}
                </DialogTitle>
                <DialogDescription className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {fileTypeLabel(activeImage.name, activeImage.mime)} ·{" "}
                  {formatSize(activeImage.size)}
                </DialogDescription>
                <div className="flex shrink-0 items-center gap-1">
                  {imageCount > 1 && safeIndex !== null && (
                    <>
                      <span className="px-1.5 font-mono text-xs text-muted-foreground tabular-nums">
                        {safeIndex + 1} / {imageCount}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={goPrev}
                        aria-label={t("chat.previousImage")}
                      >
                        <ChevronLeft className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={goNext}
                        aria-label={t("chat.nextImage")}
                      >
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.close")}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </DialogClose>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
