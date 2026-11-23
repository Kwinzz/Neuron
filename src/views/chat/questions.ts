/** Claude's `AskUserQuestion` input and answers. */
import type { JsonValue } from "@/bindings/serde_json/JsonValue";
import { arr, asObject, str } from "./json";

export interface QuestionOption {
  label: string;
  description: string | null;
}

export interface Question {
  question: string;
  header: string | null;
  options: QuestionOption[];
  multiSelect: boolean;
}

export function parseQuestions(input: JsonValue): Question[] {
  const list = arr(asObject(input), "questions") ?? [];
  const out: Question[] = [];
  for (const entry of list) {
    const q = asObject(entry);
    const question = str(q, "question");
    if (!question) continue;
    const options: QuestionOption[] = [];
    for (const o of arr(q, "options") ?? []) {
      const opt = asObject(o);
      const label = str(opt, "label");
      if (label) options.push({ label, description: str(opt, "description") });
    }
    out.push({ question, header: str(q, "header"), options, multiSelect: q?.multiSelect === true });
  }
  return out;
}

/** Answers from the tool result: `The user answered: "Q1"="A1", "Q2"="A2". …` */
export function parseAnswers(output: string | null): Map<string, string> {
  const answers = new Map<string, string>();
  if (!output) return answers;
  const pair = /"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g;
  for (const m of output.matchAll(pair)) {
    if (m[1] !== undefined && m[2] !== undefined) answers.set(m[1], m[2]);
  }
  return answers;
}
