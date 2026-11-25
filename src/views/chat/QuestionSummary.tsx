import { memo, useMemo } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { ChatItem } from "@/bindings/ChatItem";
import { parseAnswers, parseQuestions } from "./questions";
import { t } from "@/i18n";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** `AskUserQuestion` once answered (or skipped): the questions with the user's answers. */
export const QuestionSummary = memo(function QuestionSummary({ item }: { item: ToolItem }) {
  const questions = useMemo(() => parseQuestions(item.input), [item.input]);
  const answers = useMemo(() => parseAnswers(item.output), [item.output]);
  // Still waiting: the question card below is the one to use.
  if (item.status === "running") return null;
  const skipped = item.status !== "ok";

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 animate-in fade-in-0 duration-200">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageCircleQuestion className="size-3.5 shrink-0" />
        {skipped ? t("chat.questionsSkipped") : questions.length > 1 ? t("chat.yourAnswers") : t("chat.yourAnswer")}
      </div>
      <dl className="flex flex-col gap-1.5">
        {questions.map((q) => (
          <div key={q.question} className="flex min-w-0 flex-col gap-0.5">
            <dt className="wrap-anywhere text-xs text-muted-foreground">{q.question}</dt>
            <dd className="wrap-anywhere text-sm text-foreground select-text">{answers.get(q.question) ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
