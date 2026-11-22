import { useEffect } from "react";
import { useDashboard } from "@/stores/dashboard";
import { ActiveThreadsCard } from "./ActiveThreadsCard";
import { CacheCard } from "./CacheCard";
import { ConsumptionCard } from "./ConsumptionCard";
import { DashboardError } from "./DashboardError";
import { ProjectsCard } from "./ProjectsCard";
import { QuotasCard } from "./QuotasCard";
import { RecentThreadsCard } from "./RecentThreadsCard";
import { SectionCards } from "./SectionCards";

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
      <SectionCards />
      <ConsumptionCard />
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-3">
        <QuotasCard className="@5xl/main:col-span-2" />
        <CacheCard />
      </div>
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-3">
        <RecentThreadsCard className="@5xl/main:col-span-2" />
        <div className="flex flex-col gap-4">
          <ActiveThreadsCard />
          <ProjectsCard />
        </div>
      </div>
    </div>
  );
}
