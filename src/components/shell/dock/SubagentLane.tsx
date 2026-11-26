import { memo } from "react";
import { CornerDownRight } from "lucide-react";
import { VendorLogo } from "@/components/ui/AgentLogo";
import { t } from "@/i18n";
import type { SubagentInfo } from "@/stores/activity";
import { useUi } from "@/stores/ui";
import { subagentMeta } from "./subagentMeta";
import { SubagentStatusMark } from "./SubagentTerminal";

/**
 * One-line mention of a sub-agent under the line that launched it, in a chat's mini terminal. Its details (its
 * own terminal) are in the expanded card: clicking here expands it.
 */
export const SubagentLane = memo(function SubagentLane({ threadId, sub }: { threadId: string; sub: SubagentInfo }) {
  const meta = subagentMeta(sub);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        useUi.getState().setDockExpanded(threadId, true);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      title={t("shell.subagentShow")}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-sm pl-3 text-left text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <CornerDownRight className="size-3 shrink-0" aria-hidden />
      <VendorLogo vendor={meta.vendor} size={11} className="shrink-0" />
      <span className="shrink-0 text-foreground/80">{meta.label}</span>
      <span className="min-w-0 flex-1 truncate" title={sub.description}>
        {sub.description}
      </span>
      <SubagentStatusMark status={sub.status} />
    </button>
  );
});
