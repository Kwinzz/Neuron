/**
 * Remark plugins for chat text (agents' answers and the user's messages).
 *
 * Minimal mdast shapes are declared here: the full `mdast` types are only a transitive dependency.
 */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** Replace text nodes (never code: `code` / `inlineCode` are other node types) by the nodes `fn` returns. */
function mapText(tree: MdNode, fn: (value: string) => MdNode[] | null): void {
  const walk = (node: MdNode) => {
    const children = node.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      if (child.type === "text" && typeof child.value === "string") {
        const replaced = fn(child.value);
        if (replaced) {
          children.splice(i, 1, ...replaced);
          i += replaced.length - 1;
        }
      } else {
        walk(child);
      }
    }
  };
  walk(tree);
}

/**
 * `**Note :**texte`: CommonMark refuses to close the bold (closing `**` after punctuation, followed by a letter),
 * so the asterisks show raw. Frequent in French answers (space before the colon); every chat renderer bolds it.
 * Any `**…**` still in a text node after parsing is such a failed pair.
 */
const LOOSE_STRONG = /\*\*(?=\S)([^\n]*?\S)\*\*/g;

export function remarkLooseStrong() {
  return (tree: MdNode) =>
    mapText(tree, (value) => {
      if (!value.includes("**")) return null;
      const out: MdNode[] = [];
      let last = 0;
      for (const m of value.matchAll(LOOSE_STRONG)) {
        const inner = m[1];
        if (inner === undefined || inner.includes("**")) continue;
        if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
        out.push({ type: "strong", children: [{ type: "text", value: inner }] });
        last = m.index + m[0].length;
      }
      if (out.length === 0) return null;
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      return out;
    });
}

/**
 * A single line break is a line break (as in ChatGPT / Claude): `Ligne 1\nLigne 2` stays on two lines instead of
 * being joined into one paragraph. Chat only: a context.md wrapped at 80 columns keeps the Markdown rule.
 */
export function remarkBreaks() {
  return (tree: MdNode) =>
    mapText(tree, (value) => {
      if (!value.includes("\n")) return null;
      const lines = value.split("\n");
      const out: MdNode[] = [];
      lines.forEach((line, i) => {
        let text = line;
        if (i > 0) text = text.replace(/^[ \t]+/, "");
        if (i < lines.length - 1) text = text.replace(/[ \t]+$/, "");
        if (i > 0) out.push({ type: "break" });
        if (text) out.push({ type: "text", value: text });
      });
      return out;
    });
}
