import { useEffect, useRef, useState } from "react";
import type { MemoryHit } from "@/bindings/MemoryHit";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";

export interface MemorySearchState {
  hits: MemoryHit[];
  searching: boolean;
  error: string | null;
  active: boolean;
}

const DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 50;

export function useMemorySearch(query: string): MemorySearchState {
  const items = useMemory((s) => s.items);
  const trimmed = query.trim();
  const active = trimmed.length > 0;

  const [hits, setHits] = useState<MemoryHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!active) {
      setHits([]);
      setSearching(false);
      setError(null);
      return;
    }

    if (!isTauri()) {
      setHits([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);

    const timer = window.setTimeout(() => {
      ipc
        .searchMemories(trimmed, SEARCH_LIMIT)
        .then((result) => {
          if (requestIdRef.current !== requestId) return;
          setHits(result);
          setError(null);
          setSearching(false);
        })
        .catch((err: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setError(ipcErrorMessage(err));
          setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [trimmed, active, items]);

  if (!active) {
    return { hits: [], searching: false, error: null, active: false };
  }

  return { hits, searching, error, active: true };
}
