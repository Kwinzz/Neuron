interface NeuralNode {
  x: number;
  y: number;
  r: number;
  fill: string;
  opacity: number;
  halo?: boolean;
}

const NODES: readonly NeuralNode[] = [
  // Layer 1 (leftmost)
  { x: 54, y: 46, r: 2.5, fill: "var(--color-brand-soft)", opacity: 0.55 },
  { x: 38, y: 112, r: 3, fill: "var(--color-brand-soft)", opacity: 0.65 },
  { x: 64, y: 176, r: 2.5, fill: "var(--color-hl-2)", opacity: 0.5 },
  { x: 48, y: 224, r: 2, fill: "var(--color-brand-soft)", opacity: 0.5 },
  // Layer 2
  { x: 132, y: 34, r: 3, fill: "var(--color-brand-soft)", opacity: 0.7 },
  { x: 118, y: 92, r: 4.5, fill: "var(--color-hl-2)", opacity: 0.85, halo: true },
  { x: 144, y: 152, r: 3.5, fill: "var(--color-brand-soft)", opacity: 0.75 },
  { x: 126, y: 214, r: 3, fill: "var(--color-brand-soft)", opacity: 0.6 },
  // Layer 3
  { x: 222, y: 48, r: 3.5, fill: "var(--color-hl-2)", opacity: 0.75 },
  { x: 206, y: 108, r: 3, fill: "var(--color-brand-soft)", opacity: 0.7 },
  { x: 234, y: 164, r: 5, fill: "var(--color-brand-soft)", opacity: 0.9, halo: true },
  { x: 214, y: 226, r: 2.5, fill: "var(--color-hl-2)", opacity: 0.6 },
  // Layer 4 (rightmost)
  { x: 306, y: 36, r: 3, fill: "var(--color-brand-soft)", opacity: 0.65 },
  { x: 324, y: 88, r: 4.5, fill: "var(--color-hl-2)", opacity: 0.9, halo: true },
  { x: 298, y: 142, r: 3, fill: "var(--color-brand-soft)", opacity: 0.75 },
  { x: 332, y: 196, r: 3.5, fill: "var(--color-hl-2)", opacity: 0.7 },
  { x: 304, y: 238, r: 2.5, fill: "var(--color-brand-soft)", opacity: 0.55 },
];

const EDGES: readonly (readonly [number, number])[] = [
  // Layer 1 -> Layer 2
  [0, 4],
  [0, 5],
  [1, 4],
  [1, 5],
  [1, 6],
  [2, 5],
  [2, 6],
  [2, 7],
  [3, 6],
  [3, 7],
  // Layer 2 -> Layer 3
  [4, 8],
  [4, 9],
  [5, 8],
  [5, 9],
  [5, 10],
  [6, 9],
  [6, 10],
  [6, 11],
  [7, 10],
  [7, 11],
  // Layer 3 -> Layer 4
  [8, 12],
  [8, 13],
  [9, 12],
  [9, 13],
  [9, 14],
  [10, 13],
  [10, 14],
  [10, 15],
  [11, 14],
  [11, 15],
  [11, 16],
];

export function NeuralArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 260"
      preserveAspectRatio="xMaxYMid slice"
      className={className}
      aria-hidden
    >
      {EDGES.map(([fromIdx, toIdx], idx) => {
        const from = NODES[fromIdx];
        const to = NODES[toIdx];
        if (!from || !to) return null;
        return (
          <line
            key={idx}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--color-hl)"
            strokeOpacity={idx % 2 === 0 ? 0.24 : 0.18}
            strokeWidth={1}
          />
        );
      })}
      {NODES.map((node, idx) => (
        <g key={idx}>
          {node.halo && (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r * 2.8}
              fill={node.fill}
              fillOpacity={0.15}
            />
          )}
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={node.fill}
            fillOpacity={node.opacity}
          />
        </g>
      ))}
    </svg>
  );
}
