import { useMemo, useState } from "react";

const COLLAPSED_CHAR_CAP = 20_000;
const EXPANDED_CHAR_CAP = 400_000;

interface OutputBlockProps {
  text: string;
  maxLines?: number;
  tone?: "default" | "danger";
}

export function OutputBlock({ text, maxLines = 60, tone = "default" }: OutputBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const { totalLines, displayText, canExpand, hardTruncated } = useMemo(() => {
    const lines = text.split("\n");
    const total = lines.length;
    const exceedsLines = total > maxLines;

    if (!expanded) {
      const slicedLines = exceedsLines ? lines.slice(0, maxLines).join("\n") : text;
      const exceedsChars = slicedLines.length > COLLAPSED_CHAR_CAP;
      return {
        totalLines: total,
        displayText: exceedsChars ? slicedLines.slice(0, COLLAPSED_CHAR_CAP) : slicedLines,
        canExpand: exceedsLines || exceedsChars,
        hardTruncated: false,
      };
    }

    const tooLong = text.length > EXPANDED_CHAR_CAP;
    return {
      totalLines: total,
      displayText: tooLong ? text.slice(0, EXPANDED_CHAR_CAP) : text,
      canExpand: exceedsLines || text.length > COLLAPSED_CHAR_CAP,
      hardTruncated: tooLong,
    };
  }, [text, maxLines, expanded]);

  return (
    <div className="flex flex-col gap-1.5">
      <pre
        className={`max-h-[360px] overflow-auto rounded-md bg-bg/40 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre select-text ${
          tone === "danger" ? "text-danger" : "text-fg-muted"
        }`}
      >
        {displayText}
        {hardTruncated && "\n\n(sortie tronquée)"}
      </pre>
      {canExpand && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-bold text-accent transition-colors duration-fast hover:text-accent-strong"
          >
            {expanded ? "Réduire" : `Afficher tout (${totalLines} lignes)`}
          </button>
        </div>
      )}
    </div>
  );
}
