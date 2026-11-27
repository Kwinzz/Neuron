/** A leaf directive alone on its line, meant for the agent's own desktop app: `::browser-complete{title="…"}`,
 * `::name[label]{…}`. Neuron has no UI for them. */
const DIRECTIVE =
  /^ {0,3}::[A-Za-z][\w-]*(?:\[[^\]\n]*\])?\{(?:"[^"\n]*"|'[^'\n]*'|[^}"'\n])*\}[ \t]*$/;
/** While streaming: the last line could still become a directive (`::brow`, `::browser-complete{title="Vér`). */
const PARTIAL = /^ {0,3}::(?:[A-Za-z][\w-]*(?:\[[^\]\n]*\]?)?(?:\{[^\n]*)?)?$/;
/** Opening / closing line of a fenced code block. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Agent text without its app directives (outside code blocks); `streaming`: an unfinished one on the last line too. */
export function stripDirectives(text: string, streaming: boolean): string {
  if (!text.includes("::")) return text;
  const lines = text.split("\n");
  let fence: string | null = null;
  let removed = false;
  const kept = lines.filter((line, i) => {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
        fence = null;
      }
      return true;
    }
    if (fence !== null) return true;
    const drop = DIRECTIVE.test(line) || (streaming && i === lines.length - 1 && PARTIAL.test(line));
    removed ||= drop;
    return !drop;
  });
  return removed ? kept.join("\n") : text;
}
