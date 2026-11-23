import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Memory } from "@/bindings/Memory";
import type { MemoryCategory } from "@/bindings/MemoryCategory";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemory } from "@/stores/memory";
import { CATEGORY_ORDER } from "./categories";
import { MemoryCategoryCard } from "./MemoryCategoryCard";
import { MemoryComposer } from "./MemoryComposer";
import { MemoryHeaderCard } from "./MemoryHeaderCard";
import { MemorySearchBar } from "./MemorySearchBar";
import { MemorySearchResults } from "./MemorySearchResults";
import { useMemorySearch } from "./useMemorySearch";

const HIGHLIGHT_MS = 1600;

export function MemoryView() {
  const items = useMemory((s) => s.items);
  const info = useMemory((s) => s.info);
  const loaded = useMemory((s) => s.loaded);
  const error = useMemory((s) => s.error);

  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const prevIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    void useMemory.getState().load();
  }, []);

  const triggerHighlight = useCallback((id: string) => {
    setHighlightId(id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightId(null);
    }, HIGHLIGHT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const currentIds = new Set(items.map((item) => item.id));
    if (prevIdsRef.current === null) {
      prevIdsRef.current = currentIds;
      return;
    }
    let newestAdded: Memory | null = null;
    for (const item of items) {
      if (!prevIdsRef.current.has(item.id)) {
        if (!newestAdded || item.updatedAt > newestAdded.updatedAt) {
          newestAdded = item;
        }
      }
    }
    prevIdsRef.current = currentIds;
    if (newestAdded) {
      triggerHighlight(newestAdded.id);
    }
  }, [items, loaded, triggerHighlight]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      // A modal (delete confirmation, palette…) owns the keyboard while open.
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const { grouped, counts } = useMemo(() => {
    const byCategory: Record<MemoryCategory, Memory[]> = {
      profile: [],
      tech_preferences: [],
      code_style: [],
      strict_rules: [],
      other: [],
    };
    for (const item of items) {
      byCategory[item.category].push(item);
    }
    for (const category of CATEGORY_ORDER) {
      byCategory[category].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    const nextCounts: Record<MemoryCategory, number> = {
      profile: byCategory.profile.length,
      tech_preferences: byCategory.tech_preferences.length,
      code_style: byCategory.code_style.length,
      strict_rules: byCategory.strict_rules.length,
      other: byCategory.other.length,
    };
    return { grouped: byCategory, counts: nextCounts };
  }, [items]);

  const search = useMemorySearch(query);

  const handleFocusComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }, []);

  const handleJumpToCategory = useCallback((category: MemoryCategory) => {
    setQuery("");
    // The category cards only exist once the search results are gone: wait for that render.
    window.requestAnimationFrame(() => {
      document
        .getElementById(`memory-cat-${category}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleRetry = useCallback(() => {
    void useMemory.getState().load();
  }, []);

  const visibleCategories = useMemo(
    () => CATEGORY_ORDER.filter((category) => category !== "other" || counts.other > 0),
    [counts.other],
  );

  const blockingError = error !== null && items.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <MemoryHeaderCard
        info={info}
        counts={counts}
        total={items.length}
        onNew={handleFocusComposer}
        onJumpToCategory={handleJumpToCategory}
      />

      <div className="flex min-w-0 flex-col gap-4 md:gap-6">
        {error !== null && (
          <Alert
            variant="destructive"
            className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 has-data-[slot=alert-action]:pr-28"
          >
            <AlertCircle aria-hidden />
            <AlertTitle>Mémoire indisponible</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={handleRetry}
              >
                Réessayer
              </Button>
            </AlertAction>
          </Alert>
        )}

        {!blockingError && (
          <>
            <MemoryComposer
              textareaRef={composerRef}
              onCreated={triggerHighlight}
            />

            <MemorySearchBar
              value={query}
              onChange={setQuery}
              inputRef={searchInputRef}
            />

            {!loaded ? (
              <div className="flex min-w-0 flex-col gap-4">
                {[0, 1, 2].map((i) => (
                  <Card key={i} size="sm" className="min-w-0">
                    <CardHeader>
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3.5 w-64 max-w-full" />
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2.5">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : search.active ? (
              <MemorySearchResults
                query={query}
                hits={search.hits}
                searching={search.searching}
                error={search.error}
                highlightId={highlightId}
              />
            ) : (
              <div className="flex min-w-0 flex-col gap-4">
                {visibleCategories.map((category) => (
                  <MemoryCategoryCard
                    key={category}
                    category={category}
                    items={grouped[category]}
                    highlightId={highlightId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
