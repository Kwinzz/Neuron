interface ProgressProps {
  /** 0–1 (clamped). */
  value: number;
  /** Tailwind bg class of the fill (default brand). */
  fillClassName?: string;
  /** CSS color for the fill (e.g. agent color) — overrides fillClassName. */
  color?: string;
  size?: "sm" | "md";
  className?: string;
  label?: string;
}

/** Vision progress bar: #2D2E5F track, 30px radius, GPU-friendly scaleX fill. */
export function Progress({ value, fillClassName = "bg-brand", color, size = "md", className = "", label }: ProgressProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={`w-full overflow-hidden rounded-[30px] bg-track ${size === "sm" ? "h-[3px]" : "h-[5px]"} ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <div
        className={`h-full w-full origin-left rounded-[30px] transition-transform duration-fast ${color ? "" : fillClassName}`}
        style={{ transform: `scaleX(${v})`, ...(color ? { background: color } : {}) }}
      />
    </div>
  );
}
