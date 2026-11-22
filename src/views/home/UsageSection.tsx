import { useDashboard } from "@/stores/dashboard";
import { RangeSwitch } from "./RangeSwitch";
import { SectionHeader } from "./SectionHeader";
import { UsageBreakdown } from "./UsageBreakdown";
import { UsageChart } from "./UsageChart";
import { UsageStats } from "./UsageStats";

export function UsageSection() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="CONSOMMATION"
        right={
          <RangeSwitch
            value={range}
            onChange={(r) => {
              void useDashboard.getState().setRange(r);
            }}
          />
        }
      />

      {loading && !usage ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col justify-between gap-2 bg-surface p-3">
                <div className="h-2.5 w-20 rounded-sm bg-surface-hover" />
                <div className="h-5 w-24 rounded-sm bg-surface-hover" />
              </div>
            ))}
          </div>
          <div className="h-[248px] rounded-lg border border-line bg-surface p-4" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="h-[140px] rounded-lg border border-line bg-surface p-4" />
            <div className="h-[140px] rounded-lg border border-line bg-surface p-4" />
          </div>
        </>
      ) : usage ? (
        <>
          <UsageStats totals={usage.totals} />
          <UsageChart buckets={usage.buckets} range={range} />
          <UsageBreakdown byAgent={usage.byAgent} byProject={usage.byProject} />
        </>
      ) : null}
    </section>
  );
}
