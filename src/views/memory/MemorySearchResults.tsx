import { cn } from "cn";
import { AlertCircle, Search, SearchX } from "lucide-react";
import type { MemoryHit } from "@/bindings/MemoryHit";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CardEmpty } from "@/views/project/CardEmpty";
import { MemoryRow } from "./MemoryRow";
import { t } from "@/i18n";

interface MemorySearchResultsProps {
  query: string;
  hits: MemoryHit[];
  searching: boolean;
  error: string | null;
  highlightId: string | null;
}

export function MemorySearchResults({
  query,
  hits,
  searching,
  error,
  highlightId,
}: MemorySearchResultsProps) {
  const trimmed = query.trim();

  return (
    <Card
      size="sm"
      className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("memory.results")}</span>
        </CardTitle>
        <CardDescription>{t("memory.byRelevance")}</CardDescription>
        <CardAction>
          <Badge variant="outline" className="font-mono tabular-nums">
            {hits.length}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="min-w-0">
        {error ? (
          <CardEmpty icon={AlertCircle}>{error}</CardEmpty>
        ) : searching && hits.length === 0 ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5 py-1">
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-3 w-44" />
              </div>
            ))}
          </div>
        ) : hits.length === 0 ? (
          <CardEmpty icon={SearchX}>
            {t("memory.noMatch", { query: trimmed })}
          </CardEmpty>
        ) : (
          <ul
            className={cn(
              "-mx-3 flex min-w-0 flex-col transition-opacity duration-150",
              searching && "opacity-60",
            )}
          >
            {hits.map((hit, index) => (
              <MemoryRow
                key={hit.memory.id}
                memory={hit.memory}
                index={index}
                highlighted={hit.memory.id === highlightId}
                query={trimmed}
                showCategory
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
