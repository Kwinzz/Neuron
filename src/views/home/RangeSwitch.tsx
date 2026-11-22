import { type KeyboardEvent, useRef } from "react";
import type { UsageRange } from "@/bindings/UsageRange";

interface RangeSwitchProps {
  value: UsageRange;
  onChange: (r: UsageRange) => void;
}

const RANGES: readonly { value: UsageRange; label: string }[] = [
  { value: "day", label: "Jour" },
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
];

export function RangeSwitch({ value, onChange }: RangeSwitchProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + dir + RANGES.length) % RANGES.length;
    const nextItem = RANGES[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Période de consommation"
      className="inline-flex rounded-md border border-line bg-bg-sunken p-0.5"
    >
      {RANGES.map((item, idx) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              buttonRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            className={`h-6 rounded-sm px-2.5 text-xs transition-colors duration-fast ${
              active ? "bg-surface-raised text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
