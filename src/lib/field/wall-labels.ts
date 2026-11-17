import { pointInPolygon, type Pt } from "./model.ts";

export type ScreenBox = { l: number; t: number; r: number; b: number };
export type WallEdge = { a: Pt; b: Pt; index: number; length: number; horizontal: boolean };
export type LabelLimits = { top: number; bottom: number; left: number; right: number };

export type WallLabel = {
  e: WallEdge;
  x: number;
  y: number;
  /** 1 is a normal chip. Smaller means the chip was shrunk to stay on the wall. */
  scale: number;
  /** A short line back to the wall, used only when the chip is nudged along it. */
  leader: boolean;
};

function overlap(a: ScreenBox, b: ScreenBox) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

/**
 * One chip per wall, a few pixels outside the wall (or just inside when the
 * outside sits in a neighbour or off the screen). Chips are never slid far
 * along the wall and are never dropped.
 */
export function layoutWallLabels(
  es: WallEdge[],
  view: { scale: number; tx: number; ty: number },
  placed: ScreenBox[],
  limits: LabelLimits,
  neighbors: Pt[][],
  obstacles: ScreenBox[],
): WallLabel[] {
  const viewScale = Math.max(view.scale, 1);
  const out: WallLabel[] = [];
  for (const e of es) {
    const L = e.length || 1;
    const nx = (e.b.y - e.a.y) / L;
    const ny = -(e.b.x - e.a.x) / L;
    const tx = -ny;
    const ty = nx;
    const midX = (e.a.x + e.b.x) / 2;
    const midY = (e.a.y + e.b.y) / 2;

    const tryAt = (sign: number, distPx: number, alongPx: number, chip: number, strict: boolean) => {
      const x = midX + nx * sign * (distPx / viewScale) + tx * (alongPx / viewScale);
      const y = midY + ny * sign * (distPx / viewScale) + ty * (alongPx / viewScale);
      const sx = view.tx + x * view.scale;
      const sy = view.ty + y * view.scale;
      const halfW = 32 * chip;
      const halfH = 12 * chip;
      const box = { l: sx - halfW, t: sy - halfH, r: sx + halfW, b: sy + halfH };
      if (strict) {
        if (box.l < limits.left || box.r > limits.right || box.t < limits.top || box.b > limits.bottom) return null;
        if (obstacles.some((o) => overlap(box, o))) return null;
        if (neighbors.some((poly) => pointInPolygon({ x, y }, poly))) return null;
        if (placed.some((p) => overlap(box, p))) return null;
      }
      return { e, x, y, scale: chip, leader: alongPx !== 0, box };
    };

    let chosen: ReturnType<typeof tryAt> = null;
    for (const chip of [1, 0.7]) {
      if (chosen) break;
      for (const sign of [1, -1]) {
        if (chosen) break;
        for (const dist of [14, 22]) {
          if (chosen) break;
          for (const along of [0, 14, -14]) {
            chosen = tryAt(sign, dist, along, chip, true);
            if (chosen) break;
          }
        }
      }
    }
    if (!chosen) {
      const outside = { x: midX + nx * (14 / viewScale), y: midY + ny * (14 / viewScale) };
      const sign = neighbors.some((poly) => pointInPolygon(outside, poly)) ? -1 : 1;
      chosen = tryAt(sign, 14, 0, 0.7, false);
    }
    if (!chosen) continue;
    placed.push(chosen.box);
    out.push({ e, x: chosen.x, y: chosen.y, scale: chosen.scale, leader: chosen.leader });
  }
  return out;
}

/** Screen distance from a chip to the middle of its wall. */
export function labelOffsetPx(label: WallLabel, view: { scale: number; tx: number; ty: number }): number {
  const mx = (label.e.a.x + label.e.b.x) / 2;
  const my = (label.e.a.y + label.e.b.y) / 2;
  const sx = view.tx + label.x * view.scale;
  const sy = view.ty + label.y * view.scale;
  const wx = view.tx + mx * view.scale;
  const wy = view.ty + my * view.scale;
  return Math.hypot(sx - wx, sy - wy);
}
