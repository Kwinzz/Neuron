import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { useDashboard } from "@/stores/dashboard";
import { ActivitySection } from "./ActivitySection";
import { Header } from "./Header";
import { QuotaGrid } from "./QuotaGrid";
import { UsageSection } from "./UsageSection";

export function MissionControl() {
  const error = useDashboard((s) => s.error);

  useEffect(() => {
    if (useDashboard.getState().snapshot === null) {
      void useDashboard.getState().load();
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-6">
      <Header />

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-surface px-3.5 py-2.5 text-xs text-danger"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void useDashboard.getState().load();
            }}
            className="shrink-0 rounded-md border border-line bg-surface-raised px-2.5 py-1 text-xs text-fg transition-colors duration-fast hover:bg-surface-hover"
          >
            Réessayer
          </button>
        </div>
      )}

      <QuotaGrid />
      <UsageSection />
      <ActivitySection />
    </div>
  );
}
