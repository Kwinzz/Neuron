import { memo } from "react";
import { describeStatus } from "@/lib/status";
import { useLive } from "@/stores/live";

/**
 * "Working" row shown under the conversation while the agent works and nothing is streaming yet:
 * shimmering "Working" + bouncing dots + the current activity. The agent logo is the timeline's
 * AgentCursor, which sits in the gutter next to this row.
 */
export const WorkingIndicator = memo(function WorkingIndicator({ threadId }: { threadId: string }) {
  const status = useLive((s) => s.threads[threadId]?.status ?? "starting");
  const detail = useLive((s) => s.threads[threadId]?.detail ?? null);
  const activity = status === "thinking" || status === "starting" ? null : describeStatus(status, detail);

  return (
    <div
      className="flex h-7 items-center gap-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      role="status"
      aria-live="polite"
    >
      {/* Dots sit on the word's baseline ("Working..."), not centered next to it. */}
      <span className="inline-flex items-end gap-1">
        <span className="chat-working-text text-sm leading-none font-medium">Working</span>
        <span className="flex items-end gap-[3px] pb-px" aria-hidden>
          <span className="chat-working-dot" />
          <span className="chat-working-dot" />
          <span className="chat-working-dot" />
        </span>
      </span>
      {activity && (
        <span className="min-w-0 truncate text-xs text-muted-foreground animate-in fade-in-0 duration-200" key={activity}>
          {activity}
        </span>
      )}
    </div>
  );
});
