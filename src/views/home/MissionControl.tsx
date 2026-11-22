import { useEffect } from "react";
import { useDashboard } from "@/stores/dashboard";
import { ActiveTimelineCard } from "./ActiveTimelineCard";
import { CacheCard } from "./CacheCard";
import { ConsumptionCard } from "./ConsumptionCard";
import { ErrorBanner } from "./ErrorBanner";
import { ProjectsCard } from "./ProjectsCard";
import { QuotasCard } from "./QuotasCard";
import { RecentThreadsCard } from "./RecentThreadsCard";
import { StatCards } from "./StatCards";
import { TopQuotaCard } from "./TopQuotaCard";
import { WelcomeCard } from "./WelcomeCard";

export function MissionControl() {
  const error = useDashboard((s) => s.error);

  useEffect(() => {
    if (useDashboard.getState().snapshot === null) {
      void useDashboard.getState().load();
    }
  }, []);

  return (
    <div className="@container flex flex-col gap-6 px-6 pb-8">
      {error && <ErrorBanner message={error} />}

      <StatCards />

      <div className="grid grid-cols-1 gap-[18px] @3xl:grid-cols-2 @7xl:grid-cols-[2fr_1.2fr_1.5fr] [&>*:first-child]:@3xl:col-span-2 [&>*:first-child]:@7xl:col-span-1">
        <WelcomeCard />
        <TopQuotaCard />
        <CacheCard />
      </div>

      <div className="grid grid-cols-1 gap-[18px] @5xl:grid-cols-[1.7fr_1.3fr]">
        <ConsumptionCard />
        <QuotasCard />
      </div>

      <div className="grid grid-cols-1 gap-[18px] @5xl:grid-cols-[2fr_1fr]">
        <RecentThreadsCard />
        <div className="flex flex-col gap-[18px]">
          <ActiveTimelineCard />
          <ProjectsCard />
        </div>
      </div>
    </div>
  );
}
