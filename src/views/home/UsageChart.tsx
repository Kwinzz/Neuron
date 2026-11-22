import { BarChart3 } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { AgentKind } from "@/bindings/AgentKind";
import type { UsageBucket } from "@/bindings/UsageBucket";
import type { UsageRange } from "@/bindings/UsageRange";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { bucketLabel, bucketTitle, formatTokens } from "@/lib/format";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import { useElementWidth } from "./useElementWidth";

interface UsageChartProps {
  buckets: UsageBucket[];
  range: UsageRange;
}

const LEFT_GUTTER = 48;
const TOP_PAD = 8;
const PLOT_H = 200;
const BOTTOM_GUTTER = 22;
const SVG_H = TOP_PAD + PLOT_H + BOTTOM_GUTTER;
const BASELINE_Y = TOP_PAD + PLOT_H;
const TOOLTIP_W = 204;
const TOOLTIP_GAP = 6;

function computeNiceMax(maxVal: number): number {
  if (maxVal <= 0) return 4;
  const exp = Math.floor(Math.log10(maxVal));
  const magnitude = 10 ** exp;
  const norm = maxVal / magnitude;
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (s >= norm) return s * magnitude;
  }
  return 10 * magnitude;
}

function topRoundedRectPath(x: number, y: number, w: number, h: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const right = x + w;
  const bottom = y + h;
  return `M ${x} ${bottom} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} L ${right - r} ${y} A ${r} ${r} 0 0 1 ${right} ${y + r} L ${right} ${bottom} Z`;
}

interface ComputedSegment {
  agent: AgentKind;
  value: number;
  y: number;
  h: number;
  isTop: boolean;
}

interface ComputedColumn {
  key: string;
  label: string;
  title: string;
  showLabel: boolean;
  slotX: number;
  slotW: number;
  barX: number;
  barW: number;
  total: number;
  valuesByAgent: Partial<Record<AgentKind, number>>;
  segments: ComputedSegment[];
}

export function UsageChart({ buckets, range }: UsageChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>(640);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [tableMode, setTableMode] = useState(false);
  const colRefs = useRef<(SVGGElement | null)[]>([]);

  const geometry = useMemo(() => {
    const presentSet = new Set<AgentKind>();
    let maxBucketTotal = 0;
    let grandTotal = 0;

    const rawBuckets = buckets.map((b) => {
      const valuesByAgent: Partial<Record<AgentKind, number>> = {};
      let total = 0;
      for (const entry of b.byAgent) {
        const val = entry.sums.input + entry.sums.output;
        if (val > 0) {
          valuesByAgent[entry.agent] = (valuesByAgent[entry.agent] ?? 0) + val;
          presentSet.add(entry.agent);
          total += val;
        }
      }
      if (total > maxBucketTotal) maxBucketTotal = total;
      grandTotal += total;
      return { key: b.key, valuesByAgent, total };
    });

    const presentAgents = AGENT_ORDER.filter((a) => presentSet.has(a));
    const yMax = computeNiceMax(maxBucketTotal);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      value: yMax * f,
      y: TOP_PAD + PLOT_H * (1 - f),
    }));

    const plotW = Math.max(1, width - LEFT_GUTTER);
    const n = Math.max(1, rawBuckets.length);
    const slotW = plotW / n;
    const barW = Math.min(14, Math.max(6, slotW * 0.5));
    const labelStep = range === "day" ? 3 : range === "month" ? 5 : 1;

    const columns: ComputedColumn[] = rawBuckets.map((rb, idx) => {
      const slotX = LEFT_GUTTER + idx * slotW;
      const barX = slotX + (slotW - barW) / 2;

      const activeAgents = AGENT_ORDER.filter((a) => (rb.valuesByAgent[a] ?? 0) > 0);
      const segments: ComputedSegment[] = [];
      let prevTop = BASELINE_Y;

      activeAgents.forEach((agent, segIdx) => {
        const val = rb.valuesByAgent[agent] ?? 0;
        const rawH = (val / yMax) * PLOT_H;
        const isFirst = segIdx === 0;
        const bottomY = isFirst ? BASELINE_Y : prevTop - 2;
        const h = Math.max(1, isFirst ? rawH : rawH - 2);
        const topY = bottomY - h;
        prevTop = topY;

        segments.push({
          agent,
          value: val,
          y: topY,
          h,
          isTop: segIdx === activeAgents.length - 1,
        });
      });

      return {
        key: rb.key,
        label: bucketLabel(rb.key, range),
        title: bucketTitle(rb.key, range),
        showLabel: idx % labelStep === 0,
        slotX,
        slotW,
        barX,
        barW,
        total: rb.total,
        valuesByAgent: rb.valuesByAgent,
        segments,
      };
    });

    return {
      grandTotal,
      presentAgents,
      ticks,
      columns,
    };
  }, [buckets, width, range]);

  const handleColKeyDown = (index: number, e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const count = geometry.columns.length;
    if (count === 0) return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + dir + count) % count;
    colRefs.current[nextIndex]?.focus();
  };

  if (buckets.length === 0 || geometry.grandTotal === 0) {
    return (
      <div
        ref={containerRef}
        className="glass-tile flex h-[248px] flex-col items-center justify-center gap-2 p-4 text-center"
      >
        <IconBox size={45} tone="muted">
          <BarChart3 size={22} />
        </IconBox>
        <p className="text-sm font-bold text-fg">Aucune consommation sur cette période</p>
        <p className="text-xs text-fg-muted">
          En dev, <Kbd>{MOD_LABEL}</Kbd> <Kbd>K</Kbd> → « Générer des données de démo »
        </p>
      </div>
    );
  }

  const activeCol = activeIndex != null ? geometry.columns[activeIndex] : undefined;
  let tooltipLeft = 0;
  if (activeCol != null) {
    const right = activeCol.slotX + activeCol.slotW + TOOLTIP_GAP;
    const left = activeCol.slotX - TOOLTIP_W - TOOLTIP_GAP;
    tooltipLeft =
      right + TOOLTIP_W <= width ? right : left >= 0 ? left : Math.max(0, width - TOOLTIP_W);
  }

  return (
    <div ref={containerRef} className="glass-tile p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {geometry.presentAgents.map((agent) => (
            <div key={agent} className="inline-flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: AGENTS[agent].color }}
                aria-hidden
              />
              <span className="text-xs font-bold text-fg-muted">{AGENTS[agent].label}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={tableMode}
          onClick={() => {
            setTableMode((v) => !v);
            setActiveIndex(null);
            setFocusedIndex(null);
          }}
          className="text-xs font-bold text-fg-muted transition-colors duration-fast hover:text-fg"
        >
          {tableMode ? "Graphique" : "Tableau"}
        </button>
      </div>

      {tableMode ? (
        <ChartTable presentAgents={geometry.presentAgents} columns={geometry.columns} />
      ) : (
        <div className="relative">
          <svg
            width={width}
            height={SVG_H}
            viewBox={`0 0 ${width} ${SVG_H}`}
            role="group"
            aria-label="Tokens consommés par période et par IA — flèches gauche/droite pour parcourir"
            className="block w-full overflow-visible"
          >
            {geometry.ticks.map((t) => (
              <g key={t.value}>
                <line
                  x1={LEFT_GUTTER}
                  x2={width}
                  y1={t.y}
                  y2={t.y}
                  stroke="var(--color-line-chart)"
                  strokeDasharray="5 5"
                  strokeWidth={1}
                />
                <text
                  x={LEFT_GUTTER - 8}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="var(--color-axis)"
                  fontSize={12}
                  className="tabular-nums"
                >
                  {formatTokens(t.value)}
                </text>
              </g>
            ))}

            {geometry.columns.map((col, idx) => {
              const isActive = activeIndex === idx;
              const isFocused = focusedIndex === idx;
              const isDimmed = activeIndex !== null && !isActive;

              return (
                <g
                  key={col.key}
                  ref={(el) => {
                    colRefs.current[idx] = el;
                  }}
                  tabIndex={0}
                  role="img"
                  aria-label={`${col.title}: ${formatTokens(col.total)} tokens`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(focusedIndex)}
                  onFocus={() => {
                    setActiveIndex(idx);
                    setFocusedIndex(idx);
                  }}
                  onBlur={() => {
                    setFocusedIndex((prev) => (prev === idx ? null : prev));
                    setActiveIndex((prev) => (prev === idx ? null : prev));
                  }}
                  onKeyDown={(e) => handleColKeyDown(idx, e)}
                  className={`outline-none transition-opacity duration-fast ${
                    isDimmed ? "opacity-45" : "opacity-100"
                  }`}
                >
                  {isActive && (
                    <rect
                      x={col.slotX}
                      y={TOP_PAD}
                      width={col.slotW}
                      height={PLOT_H}
                      rx={6}
                      fill="var(--color-surface-hover)"
                      fillOpacity={0.5}
                      stroke={isFocused ? "var(--color-accent)" : undefined}
                      strokeWidth={isFocused ? 1.5 : undefined}
                    />
                  )}

                  {col.segments.map((seg) =>
                    seg.isTop ? (
                      <path
                        key={seg.agent}
                        d={topRoundedRectPath(col.barX, seg.y, col.barW, seg.h, 4)}
                        fill={AGENTS[seg.agent].color}
                      />
                    ) : (
                      <rect
                        key={seg.agent}
                        x={col.barX}
                        y={seg.y}
                        width={col.barW}
                        height={seg.h}
                        fill={AGENTS[seg.agent].color}
                      />
                    ),
                  )}

                  {col.showLabel && (
                    <text
                      x={col.slotX + col.slotW / 2}
                      y={BASELINE_Y + 16}
                      textAnchor="middle"
                      fill="var(--color-axis)"
                      fontSize={12}
                    >
                      {col.label}
                    </text>
                  )}

                  <rect
                    x={col.slotX}
                    y={TOP_PAD}
                    width={col.slotW}
                    height={PLOT_H}
                    fill="transparent"
                  />
                </g>
              );
            })}
          </svg>

          {activeCol && (
            <ChartTooltip
              title={activeCol.title}
              valuesByAgent={activeCol.valuesByAgent}
              total={activeCol.total}
              left={tooltipLeft}
              width={TOOLTIP_W}
            />
          )}
        </div>
      )}
    </div>
  );
}
