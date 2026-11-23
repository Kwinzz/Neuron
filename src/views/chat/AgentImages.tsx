import { memo, useEffect, useMemo, useState } from "react";
import type { Attachment } from "@/bindings/Attachment";
import { MessageAttachments } from "@/components/attachments/MessageAttachments";
import { ipc } from "@/lib/ipc";
import { extractImagePaths } from "./imagePaths";

interface AgentImagesProps {
  threadId: string;
  /** Final text of the agent message. */
  text: string;
}

/**
 * Images the agent created or pointed at in its message, shown under it (thumbnails + full-size viewer).
 * Paths come from the text; the backend keeps the existing image files and opens them to the asset protocol.
 */
export const AgentImages = memo(function AgentImages({ threadId, text }: AgentImagesProps) {
  const paths = useMemo(() => extractImagePaths(text), [text]);
  const key = paths.join("\n");
  const [images, setImages] = useState<Attachment[]>([]);

  useEffect(() => {
    if (!key) {
      setImages([]);
      return;
    }
    let cancelled = false;
    ipc
      .agentImages(threadId, key.split("\n"))
      .then((found) => {
        if (!cancelled) setImages(found);
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, key]);

  if (images.length === 0) return null;
  return (
    <div className="mt-3 animate-in fade-in-0 duration-200">
      <MessageAttachments items={images} align="start" />
    </div>
  );
});
