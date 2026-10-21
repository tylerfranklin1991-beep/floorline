import { bbox, type Pt } from "@/lib/field/model";

/** Small live sketch of the outline captured so far. */
export function OutlinePreview({
  points,
  closed,
  size = 120,
}: {
  points: Pt[];
  closed?: boolean;
  size?: number;
}) {
  if (points.length === 0) return null;
  const b = bbox(points);
  const span = Math.max(b.w, b.h, 1);
  const pad = 10;
  const k = (size - pad * 2) / span;
  const pts = points
    .map((p) => `${pad + (p.x - b.minX) * k},${pad + (p.y - b.minY) * k}`)
    .join(" ");
  return (
    <svg width={size} height={size} className="rounded-lg bg-black/60">
      {closed ? (
        <polygon points={pts} fill="#ffffff22" stroke="#ffd29a" strokeWidth={3} />
      ) : (
        <polyline points={pts} fill="none" stroke="#ffd29a" strokeWidth={3} />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={pad + (p.x - b.minX) * k}
          cy={pad + (p.y - b.minY) * k}
          r={4}
          fill={i === 0 ? "#7fe08a" : "#fff"}
        />
      ))}
    </svg>
  );
}
