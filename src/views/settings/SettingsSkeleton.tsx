import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy="true" aria-label="Chargement des paramètres">
      {[0, 1].map((i) => (
        <Card key={i} size="sm" className="min-w-0">
          <CardHeader>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
