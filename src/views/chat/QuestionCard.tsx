import { memo, useMemo, useState } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { cn } from "cn";
import type { ChatItem } from "@/bindings/ChatItem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChat } from "@/stores/chat";
import { type Question, parseQuestions } from "./questions";
import { t } from "@/i18n";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

/** Choice of one question: picked labels + optional custom answer (« Autre »). */
interface Choice {
  picked: string[];
  other: boolean;
  text: string;
}

const EMPTY: Choice = { picked: [], other: false, text: "" };

function answerOf(q: Question, c: Choice): string {
  const custom = c.other ? c.text.trim() : "";
  if (q.multiSelect) return [...c.picked, custom].filter(Boolean).join(", ");
  return c.other ? custom : (c.picked[0] ?? "");
}

const OptionRow = memo(function OptionRow({
  selected,
  multi,
  label,
  description,
  onClick,
}: {
  selected: boolean;
  multi: boolean;
  label: string;
  description: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "border-foreground/30 bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors duration-150",
          multi ? "rounded-[4px]" : "rounded-full",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
      >
        {selected && (multi ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-foreground">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
    </button>
  );
});

/**
 * Claude asks the user (`AskUserQuestion` permission): single or multiple choice, plus a free answer.
 * The answers go back in the tool input; « Ignorer » refuses the tool.
 */
export const QuestionCard = memo(function QuestionCard({ item, threadId }: { item: PermissionItem; threadId: string }) {
  const questions = useMemo(() => parseQuestions(item.input), [item.input]);
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => EMPTY));
  const [sent, setSent] = useState(false);

  // Answered: the tool block above shows the questions with their answers.
  if (item.state !== "pending" || sent) return null;

  const update = (i: number, fn: (c: Choice) => Choice) =>
    setChoices((all) => all.map((c, j) => (j === i ? fn(c) : c)));

  const pick = (i: number, q: Question, label: string) =>
    update(i, (c) =>
      q.multiSelect
        ? { ...c, picked: c.picked.includes(label) ? c.picked.filter((l) => l !== label) : [...c.picked, label] }
        : { ...c, picked: [label], other: false },
    );

  const toggleOther = (i: number, q: Question) =>
    update(i, (c) => (q.multiSelect ? { ...c, other: !c.other } : { ...c, other: true, picked: [] }));

  const answers = questions.map((q, i) => answerOf(q, choices[i] ?? EMPTY));
  const ready = answers.every((a) => a.length > 0);

  const respond = (allow: boolean) => {
    if (sent) return;
    setSent(true);
    const map = allow ? Object.fromEntries(questions.map((q, i) => [q.question, answers[i] ?? ""])) : null;
    void useChat.getState().respondPermission(threadId, item.id, allow, null, map);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus());
  };

  return (
    <form
      aria-label={t("chat.agentQuestions")}
      className="flex flex-col gap-4 rounded-xl border border-live/30 bg-card px-4 py-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) respond(true);
      }}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <MessageCircleQuestion className="size-4 shrink-0 text-live" />
        {questions.length > 1 ? t("chat.agentHasQuestions") : t("chat.agentHasQuestion")}
      </div>

      {questions.map((q, i) => {
        const c = choices[i] ?? EMPTY;
        return (
          <fieldset key={q.question} className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 flex flex-wrap items-center gap-2">
              {q.header && <Badge variant="secondary">{q.header}</Badge>}
              <span className="text-sm text-foreground">{q.question}</span>
              <span className="text-xs text-muted-foreground">
                {q.multiSelect ? t("chat.multipleChoices") : t("chat.singleChoice")}
              </span>
            </legend>
            <div role={q.multiSelect ? "group" : "radiogroup"} className="flex flex-col gap-1.5">
              {q.options.map((o) => (
                <OptionRow
                  key={o.label}
                  multi={q.multiSelect}
                  selected={c.picked.includes(o.label)}
                  label={o.label}
                  description={o.description}
                  onClick={() => pick(i, q, o.label)}
                />
              ))}
              <OptionRow
                multi={q.multiSelect}
                selected={c.other}
                label={t("chat.otherOption")}
                description={c.other ? null : t("chat.otherOptionHint")}
                onClick={() => toggleOther(i, q)}
              />
              {c.other && (
                <Input
                  autoFocus
                  value={c.text}
                  onChange={(e) => update(i, (prev) => ({ ...prev, text: e.target.value }))}
                  placeholder={t("chat.answerPlaceholder")}
                  aria-label={t("chat.freeAnswer", { question: q.question })}
                  className="h-8 text-sm"
                />
              )}
            </div>
          </fieldset>
        );
      })}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!ready}>
          {t("chat.answer")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => respond(false)}>
          {t("chat.skip")}
        </Button>
      </div>
    </form>
  );
});
