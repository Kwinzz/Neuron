import { useEffect } from "react";
import { useDashboard } from "@/stores/dashboard";
import { CacheCard } from "./CacheCard";
import { ConsumptionCard } from "./ConsumptionCard";
import { DashboardError } from "./DashboardError";
import { QuotasCard } from "./QuotasCard";
import { RecentThreadsCard } from "./RecentThreadsCard";
import { SectionCards } from "./SectionCards";
import { SetupAgentsCard } from "./SetupAgentsCard";
import { StartChatCard } from "./StartChatCard";

export function MissionControl() {
  const error = useDashboard((s) => s.error);

  useEffect(() => {
    if (useDashboard.getState().snapshot === null) {
      void useDashboard.getState().load();
    }
  }, []);

  return (
    <div className="@container/main flex flex-col gap-4 p-4 md:gap-6 md:p-6">
      {error && <DashboardError message={error} />}
      <StartChatCard />
      <SetupAgentsCard />
      <SectionCards />
      <div
        className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
        style={{ animationDelay: "80ms" }}
      >
        <ConsumptionCard />
      </div>
      <div
        className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-3 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
        style={{ animationDelay: "140ms" }}
      >
        <QuotasCard className="@5xl/main:col-span-2" />
        <CacheCard />
      </div>
      <div
        className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
        style={{ animationDelay: "200ms" }}
      >
        <RecentThreadsCard />
      </div>
    </div>
  );
}
