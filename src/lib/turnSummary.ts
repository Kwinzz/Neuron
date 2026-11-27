/**
 * The agent's hidden end-of-answer line `<!-- neuron: ok | résumé -->` (read by the backend for notifications).
 * It ends its line and isn't glued to a backtick: an answer that quotes the format (`` `<!-- neuron: … -->` ``)
 * keeps it.
 */
const SUMMARY_LINE = /(?:^|\n+|[ \t]+)<!--\s*neuron\s*:[^\n]*?-->(?=[ \t]*(?:\n|$))[ \t]*/gi;
/**
 * While streaming: the line has started but isn't closed yet (`<!-- neur…`). A lone `<` only at the start of a
 * line: an answer ending with « a < » keeps its last character.
 */
const PARTIAL_TAIL =
  /(?:(?:^|\n+)[ \t]*<|(?:^|\n+|[ \t]+)<!(?:-(?:-(?:\s*n(?:e(?:u(?:r(?:o(?:n[^\n]*)?)?)?)?)?)?)?)?)$/i;

/** Agent text as shown in the chat: summary line removed, also while it is being streamed. */
export function stripSummaryLine(text: string): string {
  if (!text.includes("<")) return text;
  return text.replace(SUMMARY_LINE, "").replace(PARTIAL_TAIL, "");
}
