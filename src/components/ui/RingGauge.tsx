import type { ReactNode } from "react";

interface RingGaugeProps {
  /** 0–1 (clamped). */
  value: number;
  /** CSS color of the arc (e.g. "var(--color-brand)"). */
  color?: string;
  size?: number;
  thickness?: number;
  /** Partial ring: sweep angle in degrees (360 = full circle, 240 = Vision "gauge"). */
  sweep?: number;
  children?: ReactNode;
  label?: string;
  className?: string;
}

/** Circular progress (SVG), content centered. */
export function RingGauge({
  value,
  color = "var(--color-brand)",
  size = 168,
  thickness = 8,
  sweep = 360,
  children,
  label,
  className = "",
}: RingGaugeProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = (circumference * sweep) / 360;
  // Start angle so that a partial ring is centered at the bottom gap.
  const rotate = sweep >= 360 ? -90 : 90 + (360 - sweep) / 2;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden>
        <g transform={`rotate(${rotate} ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-track)"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
          />
          {v > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${arc * v} ${circumference}`}
              style={{ transition: "stroke-dasharray 300ms var(--ease-out-quick)" }}
            />
          )}
        </g>
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
