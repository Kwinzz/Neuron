import { memo } from "react";
import { cn } from "cn";
import type { Memory } from "@/bindings/Memory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardEmpty } from "@/views/project/CardEmpty";
import { CATEGORIES } from "./categories";
import { MemoryRow } from "./MemoryRow";

interface MemoryCategoryCardProps {
  category: MemoryCategory;
  items: Memory[];
  highlightId: string | null;
}

export const MemoryCategoryCard = memo(function MemoryCategoryCard({
  category,
  items,
  highlightId,
}: MemoryCategoryCardProps) {
  const meta = CATEGORIES[category];
  const Icon = meta.icon;

  return (
    <Card
      size="sm"
      id={`memory-cat-${category}`}
      className={cn(
        "min-w-0 scroll-mt-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
        category === "strict_rules" && "ring-warn/25",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className={cn("size-4 shrink-0", meta.iconClass)} aria-hidden />
          <span>{meta.label}</span>
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
        <CardAction>
          <Badge variant="outline" className="font-mono tabular-nums">
            {items.length}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="min-w-0">
        {items.length === 0 ? (
          <CardEmpty icon={Icon}>
            Aucun souvenir. Ex. : « {meta.example} »
          </CardEmpty>
        ) : (
          <ul className="-mx-3 flex min-w-0 flex-col">
            {items.map((memory, index) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                index={index}
                highlighted={memory.id === highlightId}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
});
