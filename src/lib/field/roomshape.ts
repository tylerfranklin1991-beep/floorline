/**
 * "Room shape from photos": the user taps the floor corners in order on one or
 * more photos. Perspective ruins lengths and exact angles, but keeps which way
 * each corner turns, so we read the wall count and inside/outside corners from
 * the taps, snap every turn to 90° (or 45°), and the user types every length.
 */
import type { Pt } from "./model.ts";

export type Turn = 90 | -90 | 45 | -45;

/** Signed turn (degrees, + = left in image coords where y is down → we flip) at each tapped corner. */
export function rawTurns(pts: Pt[]): number[] {
  const n = pts.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = ((h2 - h1) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    out.push(d);
  }
  return out;
}

/**
 * Snap the corners' turns. Turn i is the turn at the END of wall i (corner i+1).
 * Returned so that the shape winds clockwise on screen (sum = +360).
 */
export function snapTurns(pts: Pt[], allow45 = true): Turn[] {
  const raw = rawTurns(pts);
  const sign = raw.reduce((s, t) => s + t, 0) >= 0 ? 1 : -1;
  // raw[i] is at corner i (between wall i-1 and wall i); re-index to end-of-wall.
  const n = pts.length;
  return raw.map((_, i) => {
    const t = raw[(i + 1) % n] * sign;
    const mag = allow45 && Math.abs(t) < 67.5 ? 45 : 90;
    return (t >= 0 ? mag : -mag) as Turn;
  });
}

/** Make the turns add up to one full loop by fixing the least-confident corners. */
export function balanceTurns(turns: Turn[], target: 360 | -360 = 360): Turn[] {
  const t = [...turns];
  let sum = t.reduce<number>((s, x) => s + x, 0);
  // Flip reflex corners (or convex ones) until the loop closes at +360.
  let guard = 0;
  while (sum !== target && guard++ < t.length * 2) {
    const want = sum > target ? -1 : 1;
    const i = t.findIndex((x) => Math.sign(x) !== want && Math.abs(x) === 45);
    const j = i >= 0 ? i : t.findIndex((x) => Math.sign(x) !== want);
    if (j < 0) break;
    t[j] = (-t[j]) as Turn;
    sum = t.reduce<number>((s, x) => s + x, 0);
  }
  return t;
}

export function cornerKinds(turns: Turn[]): ("outside" | "inside")[] {
  const s = Math.sign(turns.reduce<number>((a, t) => a + t, 0)) || 1;
  return turns.map((t) => (t * s > 0 ? "outside" : "inside"));
}

/** True when the corners make one closed loop (either direction). */
export const closesLoop = (turns: Turn[]) => Math.abs(turns.reduce<number>((a, t) => a + t, 0)) === 360;

/** Directions of each wall (unit vectors), wall 0 heading right (+x). */
export function wallDirections(turns: Turn[]): Pt[] {
  let h = 0;
  return turns.map((t) => {
    const r = (h * Math.PI) / 180;
    const d = { x: Math.round(Math.cos(r) * 1e9) / 1e9, y: Math.round(Math.sin(r) * 1e9) / 1e9 };
    h += t;
    return d;
  });
}

/**
 * Build the outline from typed lengths. Missing (null) lengths are solved
 * from closure when possible: one missing wall, or the last two when they are
 * perpendicular. Returns the polygon (clockwise on screen) and the leftover gap.
 */
export function buildOutline(
  turns: Turn[],
  lengths: (number | null)[],
): { points: Pt[]; lengths: number[]; gap: number; solved: number[] } | null {
  const dirs = wallDirections(turns);
  const L = lengths.map((x) => (x && x > 0 ? x : null));
  const missing = L.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
  const known = { x: 0, y: 0 };
  L.forEach((x, i) => {
    if (x != null) {
      known.x += dirs[i].x * x;
      known.y += dirs[i].y * x;
    }
  });
  const need = { x: -known.x, y: -known.y };
  const solved: number[] = [];
  if (missing.length === 1) {
    const d = dirs[missing[0]];
    const v = need.x * d.x + need.y * d.y;
    if (v <= 0) return null;
    L[missing[0]] = v;
    solved.push(missing[0]);
  } else if (missing.length === 2) {
    const [i, j] = missing;
    const a = dirs[i];
    const b = dirs[j];
    const det = a.x * b.y - a.y * b.x;
    if (Math.abs(det) < 1e-9) return null;
    const s = (need.x * b.y - need.y * b.x) / det;
    const t = (a.x * need.y - a.y * need.x) / det;
    if (s <= 0 || t <= 0) return null;
    L[i] = s;
    L[j] = t;
    solved.push(i, j);
  } else if (missing.length > 2) return null;
  const pts: Pt[] = [];
  let p = { x: 0, y: 0 };
  L.forEach((x, i) => {
    pts.push(p);
    p = { x: p.x + dirs[i].x * x!, y: p.y + dirs[i].y * x! };
  });
  return { points: pts, lengths: L as number[], gap: Math.hypot(p.x, p.y), solved };
}

export type Tap = { photo: number; x: number; y: number };

/**
 * Turns from taps that may span several photos. A corner's turn is read from
 * the image only when it and both neighbours are on the same photo; otherwise
 * it defaults to an outside 90° (the user can flip it).
 */
export function turnsFromTaps(taps: Tap[], allow45 = true): Turn[] {
  const n = taps.length;
  if (n < 3) return [];
  const raw: (number | null)[] = taps.map((_, i) => {
    const a = taps[(i - 1 + n) % n];
    const b = taps[i];
    const c = taps[(i + 1) % n];
    if (a.photo !== b.photo || c.photo !== b.photo) return null;
    return rawTurns([a, b, c])[1];
  });
  const known = raw.filter((x): x is number => x != null);
  const sign = known.length && known.reduce((s, t) => s + t, 0) < 0 ? -1 : 1;
  // Keep the tapped direction (no mirroring): a photo of the floor isn't flipped.
  const out = raw.map((_, i) => {
    const t = raw[(i + 1) % n];
    if (t == null) return (90 * sign) as Turn;
    const mag = allow45 && Math.abs(t) < 67.5 ? 45 : 90;
    return (t >= 0 ? mag : -mag) as Turn;
  });
  return balanceTurns(out, sign > 0 ? 360 : -360);
}

/** Cycle a corner: 90 → −90 → 45 → −45 (sign relative to screen). */
export function cycleTurn(t: Turn): Turn {
  return ({ 90: -90, [-90]: 45, 45: -45, [-45]: 90 } as Record<number, Turn>)[t];
}
