/** The agent's hidden end-of-answer line `<!-- neuron: ok | résumé -->` (read by the backend for notifications). */
const SUMMARY_LINE = /\n*[ \t]*<!--\s*neuron\s*:[\s\S]*?-->[ \t]*/gi;
/** While streaming: the line has started but isn't closed yet (`<!-- neur…`). */
const PARTIAL_TAIL = /\n*[ \t]*<(?:!(?:-(?:-(?:\s*n(?:e(?:u(?:r(?:o(?:n[\s\S]*)?)?)?)?)?)?)?)?)?$/i;

/** Agent text as shown in the chat: summary line removed, also while it is being streamed. */
export function stripSummaryLine(text: string): string {
  if (!text.includes("<")) return text;
  return text.replace(SUMMARY_LINE, "").replace(PARTIAL_TAIL, "");
}
