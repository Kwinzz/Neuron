import { Coffee } from "lucide-react";
import { Card } from "@/components/legacy/Card";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { useDashboard } from "@/stores/dashboard";
import { Placeholder } from "./Placeholder";
import { TimelineItem } from "./TimelineItem";

export function ActiveTimelineCard() {
  const activeThreads = useDashboard((s) => s.snapshot?.activeThreads);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !activeThreads;

  const count = activeThreads?.length ?? 0;
  const subtitle = isLoading
    ? undefined
    : `${count} ${count <= 1 ? "thread actif" : "threads actifs"}`;

  return (
    <Card title="En cours" subtitle={subtitle}>
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Placeholder key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !activeThreads || activeThreads.length === 0 ? (
        <div className="flex items-center gap-3 py-2">
          <IconBox size={30} tone="muted">
            <Coffee size={15} />
          </IconBox>
          <div>
            <p className="text-sm font-bold text-fg">Aucun agent en cours</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Lancez un thread depuis la palette <Kbd>{MOD_LABEL}</Kbd> <Kbd>K</Kbd>
            </p>
          </div>
        </div>
      ) : (
        <ol className="relative max-h-[360px] overflow-y-auto overflow-x-hidden">
          {activeThreads.map((t, idx) => (
            <TimelineItem
              key={t.id}
              id={t.id}
              fallback={t}
              isLast={idx === activeThreads.length - 1}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}
