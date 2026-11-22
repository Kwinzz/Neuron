import { memo } from "react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { describeStatus } from "@/lib/status";
import { useLive } from "@/stores/live";

/**
 * "Working" row shown under the conversation while the agent works and nothing is streaming yet:
 * agent logo (breathing) + shimmering "Working" + bouncing dots + the current activity.
 */
export const WorkingIndicator = memo(function WorkingIndicator({ threadId }: { threadId: string }) {
  const agent = useLive((s) => s.threads[threadId]?.agent ?? "claude_code");
  const status = useLive((s) => s.threads[threadId]?.status ?? "starting");
  const detail = useLive((s) => s.threads[threadId]?.detail ?? null);
  const activity = status === "thinking" || status === "starting" ? null : describeStatus(status, detail);

  return (
    <div
      className="flex items-center gap-2.5 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      role="status"
      aria-live="polite"
    >
      <span className="chat-working-logo flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card">
        <AgentLogo agent={agent} size={15} />
      </span>
      <span className="chat-working-text text-sm font-medium">Working</span>
      <span className="flex items-end gap-0.5 pb-0.5" aria-hidden>
        <span className="chat-working-dot" />
        <span className="chat-working-dot" />
        <span className="chat-working-dot" />
      </span>
      {activity && (
        <span className="min-w-0 truncate text-xs text-muted-foreground animate-in fade-in-0 duration-200" key={activity}>
          {activity}
        </span>
      )}
    </div>
  );
});
