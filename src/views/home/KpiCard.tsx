import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaBadge } from "./DeltaBadge";

interface KpiCardProps {
  label: string;
  value: string;
  delta: number | null;
  /** Shown as a tooltip on the label (no text under the number). */
  hint?: string;
  loading: boolean;
  index?: number;
}

export function KpiCard({ label, value, delta, hint, loading, index }: KpiCardProps) {
  return (
    <Card
      className="@container/card animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
      style={index !== undefined ? { animationDelay: `${index * 40}ms` } : undefined}
    >
      <CardHeader>
        {loading ? (
          <>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-28" />
          </>
        ) : (
          <>
            <CardDescription title={hint}>{label}</CardDescription>
            <CardTitle
              key={value}
              className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl animate-in fade-in-0 duration-300"
            >
              {value}
            </CardTitle>
            <CardAction>
              <DeltaBadge ratio={delta} />
            </CardAction>
          </>
        )}
      </CardHeader>
    </Card>
  );
}
