import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface DeltaBadgeProps {
  ratio: number | null;
}

export function DeltaBadge({ ratio }: DeltaBadgeProps) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return (
      <Badge variant="outline" title="Pas de période précédente comparable">
        —
      </Badge>
    );
  }

  const pct = Math.round(ratio * 100);
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const text = pct > 0 ? `+${pct} %` : pct < 0 ? `\u2212${Math.abs(pct)} %` : "0 %";

  return (
    <Badge variant="outline" className="tabular-nums">
      <Icon aria-hidden />
      <span>{text}</span>
      <span className="sr-only">par rapport à la période précédente</span>
    </Badge>
  );
}
