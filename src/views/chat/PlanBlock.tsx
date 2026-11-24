import { memo } from "react";
import type { ChatItem } from "@/bindings/ChatItem";
import { asObject, str } from "./json";
import { MarkdownFileCard } from "./MarkdownFileCard";
import { baseName } from "./planDocs";
import { t } from "@/i18n";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Plan proposed by Claude in Plan mode (`ExitPlanMode`), shown as its Markdown file. */
export const PlanBlock = memo(function PlanBlock({ item }: { item: ToolItem }) {
  const input = asObject(item.input);
  const plan = str(input, "plan") ?? "";
  const file = str(input, "planFilePath");
  // Refused from the approval bar: Claude keeps planning (the result is an error).
  const dropped = item.status === "error" || item.status === "denied";

  return (
    <MarkdownFileCard
      name={file ? baseName(file) : "plan.md"}
      path={file}
      content={plan.trim() ? plan : t("chat.emptyPlan")}
      badge={t("chat.planBadge")}
      note={dropped ? t("chat.planDropped") : undefined}
    />
  );
});
