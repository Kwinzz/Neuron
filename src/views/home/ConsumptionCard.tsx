import { Card } from "@/components/ui/Card";
import { formatTokens } from "@/lib/format";
import { useDashboard } from "@/stores/dashboard";
import { AgentShares } from "./AgentShares";
import { Placeholder } from "./Placeholder";
import { RangeSwitch } from "./RangeSwitch";
import { RANGE_LABEL } from "./rangeLabel";
import { UsageChart } from "./UsageChart";

export function ConsumptionCard() {
  const usage = useDashboard((s) => s.snapshot?.usage);
  const range = useDashboard((s) => s.range);
  const loading = useDashboard((s) => s.loading);
  const isLoading = loading && !usage;

  const totalTokens = usage ? usage.totals.input + usage.totals.output : 0;
  const subtitle = usage
    ? `${formatTokens(totalTokens)} tokens · ${RANGE_LABEL[range]}`
    : RANGE_LABEL[range];

  return (
    <Card
      title="Consommation"
      subtitle={subtitle}
      actions={
        <RangeSwitch
          value={range}
          onChange={(r) => {
            void useDashboard.getState().setRange(r);
          }}
        />
      }
    >
      {isLoading ? (
        <>
          <div className="glass-tile p-4">
            <Placeholder className="h-[240px] w-full" />
          </div>
          <AgentShares byAgent={[]} loading />
        </>
      ) : (
        <>
          <UsageChart buckets={usage?.buckets ?? []} range={range} />
          <AgentShares byAgent={usage?.byAgent ?? []} />
        </>
      )}
    </Card>
  );
}
