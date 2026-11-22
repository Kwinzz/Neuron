import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/stores/dashboard";
import { QuotaRow } from "./QuotaRow";

interface QuotasCardProps {
  className?: string;
}

export function QuotasCard({ className }: QuotasCardProps) {
  const providers = useDashboard((s) => s.snapshot?.providers);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !providers;

  const count = providers?.length ?? 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Quotas &amp; abonnements</CardTitle>
        {!isLoading && (
          <CardDescription>
            {count} {count <= 1 ? "fournisseur" : "fournisseurs"}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col divide-y">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-1 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : !providers || providers.length === 0 ? (
          <p className="text-sm text-muted-foreground animate-in fade-in-0 duration-300">Aucun fournisseur configuré</p>
        ) : (
          <div className="flex flex-col divide-y animate-in fade-in-0 duration-300">
            {providers.map((usage) => (
              <QuotaRow key={usage.provider.id} usage={usage} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
