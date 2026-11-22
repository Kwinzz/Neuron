import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { IconBox } from "@/components/ui/IconBox";
import { Delta } from "./Delta";
import { Placeholder } from "./Placeholder";

interface StatCardProps {
  label: string;
  value: string;
  delta: number | null;
  icon: ReactNode;
  loading?: boolean;
}

export function StatCard({ label, value, delta, icon, loading = false }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="flex flex-col gap-2">
              <Placeholder className="h-3.5 w-24" />
              <Placeholder className="h-5 w-20" />
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-bold text-fg-muted">{label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums text-fg">{value}</span>
                <Delta ratio={delta} />
              </div>
            </>
          )}
        </div>
        <IconBox size={45} tone="brand">
          {icon}
        </IconBox>
      </div>
    </Card>
  );
}
