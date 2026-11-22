import { useDashboard } from "@/stores/dashboard";

export function Header() {
  const queryUs = useDashboard((s) => s.snapshot?.queryUs);

  return (
    <header className="flex items-center justify-between gap-4">
      <h1 className="text-base font-medium text-fg">Mission Control</h1>
      {queryUs != null && (
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          SQLite · {(queryUs / 1000).toFixed(1)} ms
        </span>
      )}
    </header>
  );
}
