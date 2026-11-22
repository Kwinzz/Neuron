import { type LucideIcon, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaBadge } from "./DeltaBadge";

interface KpiCardProps {
  label: string;
  value: string;
  delta: number | null;
  detail: string;
  loading: boolean;
}

function describeTrend(ratio: number | null): { text: string; Icon: LucideIcon | null } {
  if (ratio === null || !Number.isFinite(ratio)) {
    return { text: "Pas de période comparable", Icon: null };
  }
  const pct = Math.round(ratio * 100);
  if (pct > 0) return { text: "En hausse vs période précédente", Icon: TrendingUp };
  if (pct < 0) return { text: "En baisse vs période précédente", Icon: TrendingDown };
  return { text: "Stable vs période précédente", Icon: Minus };
}

export function KpiCard({ label, value, delta, detail, loading }: KpiCardProps) {
  const { text, Icon } = describeTrend(delta);

  return (
    <Card className="@container/card">
      <CardHeader>
        {loading ? (
          <>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-28" />
          </>
        ) : (
          <>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {value}
            </CardTitle>
            <CardAction>
              <DeltaBadge ratio={delta} />
            </CardAction>
          </>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        {loading ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <>
            <div className="line-clamp-1 flex items-center gap-2 font-medium">
              {text}
              {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            </div>
            <div className="text-muted-foreground">{detail}</div>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
