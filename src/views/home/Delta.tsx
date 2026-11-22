import { ArrowDown, ArrowUp } from "lucide-react";

interface DeltaProps {
  ratio: number | null;
}

export function Delta({ ratio }: DeltaProps) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return (
      <span
        className="text-sm font-bold text-fg-subtle"
        title="Pas de période précédente comparable"
      >
        —
      </span>
    );
  }

  const pct = Math.round(ratio * 100);
  const text = pct > 0 ? `+${pct} %` : pct < 0 ? `\u2212${Math.abs(pct)} %` : "0 %";

  return (
    <span
      className="inline-flex items-center gap-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-accent-2"
      title="vs période précédente"
    >
      {ratio > 0 && pct !== 0 && <ArrowUp size={14} aria-hidden />}
      {ratio < 0 && pct !== 0 && <ArrowDown size={14} aria-hidden />}
      <span>{text}</span>
      <span className="sr-only">par rapport à la période précédente</span>
    </span>
  );
}
