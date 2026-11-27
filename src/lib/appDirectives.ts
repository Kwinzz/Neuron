/**
 * Some agents (Codex) end steps with directives meant for their own desktop app, alone on a line:
 * `::browser-complete{title="…"}`, `::git-stage{cwd="…"}`. Neuron has no UI for them, so they would show as raw
 * text in the chat.
 */
const DIRECTIVE_LINE = /^[ \t]*::[A-Za-z][\w-]*(?:\[[^\]\n]*\])?\{[^\n]*\}[ \t]*$/;
/** While streaming: a directive that has started on the last line but isn't closed yet (`::browser-comp…`). */
const PARTIAL_TAIL = /^[ \t]*::(?:[A-Za-z][\w-]*(?:\[[^\]\n]*\]?)?(?:\{[^}\n]*)?)?$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Agent text as shown in the chat: app directive lines removed (outside code blocks). While `streaming`, an
 * unfinished directive on the last line is hidden too, so it never flashes before being removed.
 */
export function stripAppDirectives(text: string, streaming = false): string {
  if (!text.includes("::")) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
    } else if (DIRECTIVE_LINE.test(line) || (streaming && i === lines.length - 1 && PARTIAL_TAIL.test(line))) {
      return;
    }
    kept.push(line);
  });
  return kept.join("\n");
}
