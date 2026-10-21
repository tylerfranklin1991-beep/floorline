/**
 * Floorline field model: properties made of rectilinear rooms.
 *
 * All geometry is pure and framework-free so it can be unit tested.
 * Coordinates are in the property's units (feet or metres), +x right, +y down.
 * Every room is a closed, axis-aligned polygon ("rectilinear"): every wall is
 * either horizontal or vertical, which is what keeps layouts clean.
 */

export type Units = "ft" | "m";
export type Pt = { x: number; y: number };
export type OpeningKind = "door" | "window" | "opening";

export interface RoomPhoto {
  id: string;
  /** Small JPEG data URL so the diagram and exports can show it without IndexedDB. */
  thumb: string;
  takenAt: number;
}

export interface FieldRoom {
  id: string;
  name: string;
  /** Closed polygon, no repeated last point. */
  points: Pt[];
  photos: RoomPhoto[];
  notes: string;
  /** How the shape was made, shown so the user knows how much to trust it. */
  source: "ar" | "walk" | "draw" | "typed";
  /** Level (floor) this room is on. */
  levelId: string;
}

export interface FieldLevel {
  id: string;
  name: string;
}

/** Direction the stairs arrow points (the way you walk when going UP/DOWN). */
export type StairsHeading = "n" | "e" | "s" | "w";

export interface FieldStairs {
  id: string;
  levelId: string;
  /** Top-left corner of the footprint. */
  x: number;
  y: number;
  /** Across the treads. */
  width: number;
  /** Along the run (the arrow direction). */
  length: number;
  heading: StairsHeading;
  direction: "up" | "down";
  /** Step count typed by the user (never auto-detected). */
  steps: number | null;
  /** Level the stairs lead to, if linked. */
  toLevelId: string | null;
}

export interface FieldOpening {
  id: string;
  roomId: string;
  kind: OpeningKind;
  /** Index of the wall (edge from points[wall] to points[wall+1]). */
  wall: number;
  /** Distance from the wall's start corner to the opening's centre. */
  offset: number;
  width: number;
}

export interface FieldProperty {
  id: string;
  name: string;
  address: string;
  units: Units;
  rooms: FieldRoom[];
  openings: FieldOpening[];
  /** Floors, bottom to top is up to the user; there is always at least one. */
  levels: FieldLevel[];
  stairs: FieldStairs[];
  createdAt: number;
  updatedAt: number;
}

export const MAX_PHOTOS_PER_ROOM = 2;

export const ROOM_PRESETS = [
  "Living",
  "Kitchen",
  "Dining",
  "Bedroom",
  "Bath",
  "Hall",
  "Closet",
  "Laundry",
  "Office",
  "Garage",
  "Entry",
  "Other",
];

export const LEVEL_PRESETS = ["Basement", "Main", "2nd floor", "3rd floor", "Attic"];

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** Grid step used for drawing and dragging. */
export function gridStep(units: Units): number {
  return units === "ft" ? 0.5 : 0.1;
}

export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function rectPoints(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function newProperty(name: string, units: Units = "ft"): FieldProperty {
  const now = Date.now();
  return {
    id: uid("prop"),
    name: name.trim() || "New property",
    address: "",
    units,
    rooms: [],
    openings: [],
    levels: [{ id: "level-main", name: "Main" }],
    stairs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newRoom(
  name: string,
  points: Pt[],
  source: FieldRoom["source"],
  levelId = "level-main",
): FieldRoom {
  return {
    id: uid("room"),
    name: name.trim() || "Room",
    points,
    photos: [],
    notes: "",
    source,
    levelId,
  };
}

/* --------------------------------------------------------------- levels */

/** The property as seen on one level: only that level's rooms, openings and stairs. */
export function levelView(p: FieldProperty, levelId: string): FieldProperty {
  const rooms = p.rooms.filter((r) => r.levelId === levelId);
  const ids = new Set(rooms.map((r) => r.id));
  return {
    ...p,
    rooms,
    openings: p.openings.filter((o) => ids.has(o.roomId)),
    stairs: p.stairs.filter((s) => s.levelId === levelId),
  };
}

export function levelName(p: FieldProperty, levelId: string | null): string {
  return p.levels.find((l) => l.id === levelId)?.name ?? "";
}

/** Suggested name for the next level ("Basement", "2nd floor", ...). */
export function nextLevelName(p: FieldProperty): string {
  const used = new Set(p.levels.map((l) => l.name.toLowerCase()));
  return LEVEL_PRESETS.find((n) => !used.has(n.toLowerCase())) ?? `Level ${p.levels.length + 1}`;
}

/** Remove a level and everything on it. Refuses to remove the last level. */
export function removeLevel(p: FieldProperty, levelId: string): FieldProperty {
  if (p.levels.length <= 1 || !p.levels.some((l) => l.id === levelId)) return p;
  const rooms = p.rooms.filter((r) => r.levelId !== levelId);
  const ids = new Set(rooms.map((r) => r.id));
  return {
    ...p,
    levels: p.levels.filter((l) => l.id !== levelId),
    rooms,
    openings: p.openings.filter((o) => ids.has(o.roomId)),
    stairs: p.stairs
      .filter((s) => s.levelId !== levelId)
      .map((s) => (s.toLevelId === levelId ? { ...s, toLevelId: null } : s)),
  };
}

/* --------------------------------------------------------------- stairs */

export function newStairs(levelId: string, at: Pt, units: Units): FieldStairs {
  const w = units === "ft" ? 3 : 0.9;
  const l = units === "ft" ? 10 : 3;
  return {
    id: uid("stairs"),
    levelId,
    x: round2(at.x - w / 2),
    y: round2(at.y - l / 2),
    width: w,
    length: l,
    heading: "n",
    direction: "up",
    steps: null,
    toLevelId: null,
  };
}

/** Footprint rectangle in plan space (width/length swap when the run is east-west). */
export function stairsRect(s: FieldStairs) {
  const ns = s.heading === "n" || s.heading === "s";
  return { x: s.x, y: s.y, w: ns ? s.width : s.length, h: ns ? s.length : s.width };
}

export function stairsPoints(s: FieldStairs): Pt[] {
  const r = stairsRect(s);
  return rectPoints(r.x, r.y, r.w, r.h);
}

/** Plan label, e.g. "UP 14" or "DN". */
export function stairsLabel(s: FieldStairs): string {
  return `${s.direction === "up" ? "UP" : "DN"}${s.steps ? ` ${s.steps}` : ""}`;
}

/** Tread lines across the run; uses the typed step count, else ~1 per 10 in / 25 cm. */
export function stairsTreads(s: FieldStairs, units: Units): { a: Pt; b: Pt }[] {
  const r = stairsRect(s);
  const ns = s.heading === "n" || s.heading === "s";
  const tread = units === "ft" ? 10 / 12 : 0.25;
  const n = Math.max(2, Math.min(40, s.steps ?? Math.round(s.length / tread)));
  const out: { a: Pt; b: Pt }[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push(
      ns
        ? { a: { x: r.x, y: r.y + r.h * t }, b: { x: r.x + r.w, y: r.y + r.h * t } }
        : { a: { x: r.x + r.w * t, y: r.y }, b: { x: r.x + r.w * t, y: r.y + r.h } },
    );
  }
  return out;
}

/** Arrow along the run's centre line, from tail to head (head is the heading side). */
export function stairsArrow(s: FieldStairs): { from: Pt; to: Pt } {
  const r = stairsRect(s);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const m = 0.12;
  switch (s.heading) {
    case "n":
      return { from: { x: cx, y: r.y + r.h * (1 - m) }, to: { x: cx, y: r.y + r.h * m } };
    case "s":
      return { from: { x: cx, y: r.y + r.h * m }, to: { x: cx, y: r.y + r.h * (1 - m) } };
    case "e":
      return { from: { x: r.x + r.w * m, y: cy }, to: { x: r.x + r.w * (1 - m), y: cy } };
    default:
      return { from: { x: r.x + r.w * (1 - m), y: cy }, to: { x: r.x + r.w * m, y: cy } };
  }
}

/** Turn the arrow 90° clockwise about the footprint centre. */
export function rotateStairs(s: FieldStairs): FieldStairs {
  const r = stairsRect(s);
  const next: StairsHeading = ({ n: "e", e: "s", s: "w", w: "n" } as const)[s.heading];
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rotated = { ...s, heading: next };
  const r2 = stairsRect(rotated);
  return { ...rotated, x: round2(cx - r2.w / 2), y: round2(cy - r2.h / 2) };
}

export function sanitizeStairs(v: unknown, levelIds: Set<string>, fallback: string) {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<FieldStairs>;
  if (typeof s.id !== "string") return null;
  const num = (n: unknown, d: number) => (Number.isFinite(n) && Number(n) > 0 ? Number(n) : d);
  const steps = Number(s.steps);
  return {
    id: s.id,
    levelId: typeof s.levelId === "string" && levelIds.has(s.levelId) ? s.levelId : fallback,
    x: Number.isFinite(s.x) ? Number(s.x) : 0,
    y: Number.isFinite(s.y) ? Number(s.y) : 0,
    width: num(s.width, 3),
    length: num(s.length, 10),
    heading: (["n", "e", "s", "w"] as const).includes(s.heading as StairsHeading)
      ? (s.heading as StairsHeading)
      : "n",
    direction: s.direction === "down" ? "down" : "up",
    steps: Number.isInteger(steps) && steps > 0 && steps < 100 ? steps : null,
    toLevelId: typeof s.toLevelId === "string" && levelIds.has(s.toLevelId) ? s.toLevelId : null,
  } satisfies FieldStairs;
}

export type Edge = { a: Pt; b: Pt; index: number; length: number; horizontal: boolean };

export function edges(points: Pt[]): Edge[] {
  return points.map((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { a, b, index, length: Math.hypot(dx, dy), horizontal: Math.abs(dx) >= Math.abs(dy) };
  });
}

export function area(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function bbox(points: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(points: Pt[]): Pt {
  // Label anchor: centre of the bounding box nudged inside for L-shapes.
  const box = bbox(points);
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  if (pointInPolygon(c, points)) return c;
  const avg = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: avg.x / points.length, y: avg.y / points.length };
}

export function pointInPolygon(p: Pt, points: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Clockwise in screen coordinates (y down) means positive signed area here. */
export function ensureClockwise(points: Pt[]): Pt[] {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum < 0 ? [...points].reverse() : points;
}

export function isRectilinear(points: Pt[], eps = 1e-6): boolean {
  if (points.length < 4 || points.length % 2 !== 0) return false;
  return edges(points).every((e) => Math.abs(e.a.x - e.b.x) < eps || Math.abs(e.a.y - e.b.y) < eps);
}

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Dominant wall direction, as an angle in [-45°, 45°). Uses a length-weighted
 * average of edge angles folded into a 90° period, so a slightly crooked AR
 * capture still finds "the" axis of the room.
 */
export function dominantAngle(points: Pt[]): number {
  let sx = 0;
  let sy = 0;
  for (const e of edges(points)) {
    const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
    sx += e.length * Math.cos(4 * angle);
    sy += e.length * Math.sin(4 * angle);
  }
  if (sx === 0 && sy === 0) return 0;
  return Math.atan2(sy, sx) / 4;
}

/**
 * Turn rough corner points (from AR taps, a camera walk, or a hand sketch)
 * into a clean rectilinear outline:
 * 1. rotate so the dominant wall direction is horizontal,
 * 2. classify every wall as horizontal or vertical,
 * 3. merge consecutive walls on the same axis (removes jitter corners),
 * 4. rebuild corners as intersections of the averaged wall lines,
 * 5. drop near-zero walls, snap to the grid, and normalise to the origin.
 * Falls back to the bounding rectangle when the input is too degenerate.
 */
export function rectilinearize(raw: Pt[], step = 0): Pt[] {
  const pts = raw.filter((p, i) => {
    const prev = raw[(i - 1 + raw.length) % raw.length];
    return i === 0 || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6;
  });
  if (pts.length < 3) {
    const box = bbox(pts.length ? pts : [{ x: 0, y: 0 }]);
    return rectPoints(0, 0, Math.max(box.w, 1), Math.max(box.h, 1));
  }
  const angle = dominantAngle(pts);
  const rotated = pts.map((p) => rotate(p, -angle));

  type Line = { horizontal: boolean; value: number; weight: number };
  let lines: Line[] = edges(rotated).map((e) => ({
    horizontal: e.horizontal,
    value: e.horizontal ? (e.a.y + e.b.y) / 2 : (e.a.x + e.b.x) / 2,
    weight: Math.max(e.length, 1e-3),
  }));

  // Merge cyclic runs of the same axis.
  let changed = true;
  while (changed && lines.length > 1) {
    changed = false;
    for (let i = 0; i < lines.length; i += 1) {
      const j = (i + 1) % lines.length;
      if (i !== j && lines[i].horizontal === lines[j].horizontal) {
        const w = lines[i].weight + lines[j].weight;
        const merged = {
          horizontal: lines[i].horizontal,
          value: (lines[i].value * lines[i].weight + lines[j].value * lines[j].weight) / w,
          weight: w,
        };
        lines = lines.filter((_, k) => k !== i && k !== j);
        lines.splice(Math.min(i, lines.length), 0, merged);
        changed = true;
        break;
      }
    }
  }

  let out: Pt[];
  if (lines.length < 4) {
    const box = bbox(rotated);
    out = rectPoints(box.minX, box.minY, Math.max(box.w, 1), Math.max(box.h, 1));
  } else {
    out = lines.map((line, i) => {
      const prev = lines[(i - 1 + lines.length) % lines.length];
      // Corner where the previous wall meets this one.
      return line.horizontal ? { x: prev.value, y: line.value } : { x: line.value, y: prev.value };
    });
  }
  return cleanOutline(out, step);
}

/** Snap, drop zero-length and collinear walls, make clockwise, move to origin. */
export function cleanOutline(points: Pt[], step = 0): Pt[] {
  let out = points.map((p) => (step > 0 ? { x: snap(p.x, step), y: snap(p.y, step) } : { ...p }));
  let changed = true;
  while (changed && out.length > 4) {
    changed = false;
    for (let i = 0; i < out.length; i += 1) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      const zero = Math.hypot(cur.x - prev.x, cur.y - prev.y) < 1e-6;
      const collinear =
        (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(cur.x - next.x) < 1e-6) ||
        (Math.abs(prev.y - cur.y) < 1e-6 && Math.abs(cur.y - next.y) < 1e-6);
      if (zero || collinear) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  if (out.length < 4 || area(out) < 1e-6) {
    const box = bbox(points);
    out = rectPoints(0, 0, Math.max(round2(box.w), step || 1), Math.max(round2(box.h), step || 1));
  }
  out = ensureClockwise(out);
  const box = bbox(out);
  return out.map((p) => ({ x: round2(p.x - box.minX), y: round2(p.y - box.minY) }));
}

export function translate(points: Pt[], dx: number, dy: number): Pt[] {
  return points.map((p) => ({ x: round2(p.x + dx), y: round2(p.y + dy) }));
}

/**
 * Set wall `index` to `length`, keeping every wall horizontal/vertical.
 * The wall's end corner and the next corner slide along the wall's direction,
 * so the following wall moves intact and the opposite wall absorbs the change.
 * Returns null if the change would collapse a wall.
 */
export function setWallLength(points: Pt[], index: number, length: number): Pt[] | null {
  const n = points.length;
  if (!(length > 0) || n < 4) return null;
  const a = points[index];
  const b = points[(index + 1) % n];
  const current = Math.hypot(b.x - a.x, b.y - a.y);
  if (current === 0) return null;
  const ux = (b.x - a.x) / current;
  const uy = (b.y - a.y) / current;
  const delta = length - current;
  const i1 = (index + 1) % n;
  const i2 = (index + 2) % n;
  const next = points.map((p, k) =>
    k === i1 || k === i2 ? { x: round2(p.x + ux * delta), y: round2(p.y + uy * delta) } : { ...p },
  );
  if (edges(next).some((e) => e.length < 0.1)) return null;
  if (!isSimple(next)) return null;
  return next;
}

/** Move corner k, dragging its two walls with it so the outline stays rectilinear. */
export function moveCorner(points: Pt[], k: number, to: Pt): Pt[] {
  const n = points.length;
  const prevI = (k - 1 + n) % n;
  const nextI = (k + 1) % n;
  const cur = points[k];
  const prev = points[prevI];
  const next = points[nextI];
  const out = points.map((p) => ({ ...p }));
  out[k] = { x: round2(to.x), y: round2(to.y) };
  if (Math.abs(prev.y - cur.y) < 1e-6) out[prevI].y = out[k].y;
  else out[prevI].x = out[k].x;
  if (Math.abs(next.y - cur.y) < 1e-6) out[nextI].y = out[k].y;
  else out[nextI].x = out[k].x;
  return out;
}

/** Push wall `index` outward/inward by `d` (perpendicular), keeping it rectilinear. */
export function moveWall(points: Pt[], index: number, d: number): Pt[] {
  const n = points.length;
  const i2 = (index + 1) % n;
  const a = points[index];
  const b = points[i2];
  const horizontal = Math.abs(a.y - b.y) < 1e-6;
  return points.map((p, k) => {
    if (k !== index && k !== i2) return { ...p };
    return horizontal ? { x: p.x, y: round2(p.y + d) } : { x: round2(p.x + d), y: p.y };
  });
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  );
}

/** True when no two non-adjacent walls cross. */
export function isSimple(points: Pt[]): boolean {
  const es = edges(points);
  for (let i = 0; i < es.length; i += 1) {
    for (let j = i + 2; j < es.length; j += 1) {
      if (i === 0 && j === es.length - 1) continue;
      if (segmentsCross(es[i].a, es[i].b, es[j].a, es[j].b)) return false;
    }
  }
  return true;
}

/**
 * Magnetic snap: nudge a room so its walls line up with nearby walls of other
 * rooms (that is how rooms "connect"). Returns the offset to apply.
 */
export function magnetOffset(
  points: Pt[],
  others: Pt[][],
  tolerance: number,
): { dx: number; dy: number } {
  const box = bbox(points);
  let bestX = { d: Infinity, v: 0 };
  let bestY = { d: Infinity, v: 0 };
  const xs = [box.minX, box.maxX];
  const ys = [box.minY, box.maxY];
  for (const other of others) {
    const ob = bbox(other);
    for (const x of xs) {
      for (const ox of [ob.minX, ob.maxX]) {
        const d = ox - x;
        if (Math.abs(d) <= tolerance && Math.abs(d) < Math.abs(bestX.d)) bestX = { d, v: d };
      }
    }
    for (const y of ys) {
      for (const oy of [ob.minY, ob.maxY]) {
        const d = oy - y;
        if (Math.abs(d) <= tolerance && Math.abs(d) < Math.abs(bestY.d)) bestY = { d, v: d };
      }
    }
  }
  return {
    dx: Number.isFinite(bestX.d) ? round2(bestX.v) : 0,
    dy: Number.isFinite(bestY.d) ? round2(bestY.v) : 0,
  };
}

/** Where to put a new room: to the right of everything that exists. */
export function nextRoomOrigin(rooms: FieldRoom[]): Pt {
  if (rooms.length === 0) return { x: 0, y: 0 };
  const box = bbox(rooms.flatMap((r) => r.points));
  return { x: round2(box.maxX), y: round2(box.minY) };
}

export type WalkStep = { length: number; turn: "left" | "right" };

/**
 * Build an outline from a guided walk: start in a corner facing along a wall,
 * then for each wall record its (estimated or typed) length and which way you
 * turn at the next corner. The outline is closed and cleaned automatically.
 */
export function outlineFromWalk(steps: WalkStep[], step = 0): Pt[] {
  let dir = 0; // 0 = +x, 1 = +y, 2 = -x, 3 = -y (clockwise when turning right)
  let p: Pt = { x: 0, y: 0 };
  const pts: Pt[] = [p];
  for (const s of steps) {
    const L = Math.max(0.1, s.length);
    p = {
      x: p.x + (dir === 0 ? L : dir === 2 ? -L : 0),
      y: p.y + (dir === 1 ? L : dir === 3 ? -L : 0),
    };
    pts.push(p);
    dir = (dir + (s.turn === "right" ? 1 : 3)) % 4;
  }
  // Last point should be back at the start; drop it if so.
  const last = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(last.x, last.y) < 1e-6) pts.pop();
  return rectilinearize(pts, step);
}

/** Opening geometry on its wall, clamped inside the wall. */
export function openingSegment(
  room: FieldRoom,
  opening: FieldOpening,
): { a: Pt; b: Pt; c: Pt; inward: Pt } | null {
  const n = room.points.length;
  if (opening.wall < 0 || opening.wall >= n) return null;
  const a = room.points[opening.wall];
  const b = room.points[(opening.wall + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L === 0) return null;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const width = Math.min(opening.width, L);
  const center = Math.min(Math.max(opening.offset, width / 2), L - width / 2);
  const s = center - width / 2;
  const e = center + width / 2;
  // Clockwise outline in y-down space: interior is to the right of travel.
  const inward = { x: -uy, y: ux };
  return {
    a: { x: a.x + ux * s, y: a.y + uy * s },
    b: { x: a.x + ux * e, y: a.y + uy * e },
    c: { x: a.x + ux * center, y: a.y + uy * center },
    inward,
  };
}

/** Closest wall of a room to a point, with the offset along it. */
export function nearestWall(
  points: Pt[],
  p: Pt,
): { wall: number; offset: number; distance: number } {
  let best = { wall: 0, offset: 0, distance: Infinity };
  for (const e of edges(points)) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / L2));
    const q = { x: e.a.x + dx * t, y: e.a.y + dy * t };
    const distance = Math.hypot(p.x - q.x, p.y - q.y);
    if (distance < best.distance) best = { wall: e.index, offset: t * Math.sqrt(L2), distance };
  }
  return best;
}

export function defaultOpeningWidth(kind: OpeningKind, units: Units): number {
  const ft = kind === "window" ? 3 : kind === "door" ? 2.67 : 4;
  return units === "ft" ? ft : round2(ft * 0.3048);
}

/** Human-friendly length: 12'-6" or 3.81 m. */
export function formatLength(n: number, units: Units): string {
  if (!Number.isFinite(n)) return "";
  if (units === "m") return `${round2(n).toFixed(2)} m`;
  const total = Math.round(Math.abs(n) * 12);
  const feet = Math.floor(total / 12);
  const inches = total % 12;
  return inches === 0 ? `${feet}'` : `${feet}'-${inches}"`;
}

export function formatArea(a: number, units: Units): string {
  return units === "m" ? `${Math.round(a * 10) / 10} m²` : `${Math.round(a)} sq ft`;
}

/**
 * Parse typed lengths. Feet accepts 12, 12.5, 12' 6", 12'6, 12-6, 12 6, 6".
 * Metres accepts 3.2, 3,2, 320cm. Returns null if it can't be read.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  if (units === "m") {
    const cm = s.match(/^(\d+(?:\.\d+)?)\s*cm$/);
    if (cm) return round2(Number(cm[1]) / 100);
    const m = s.match(/^(\d+(?:\.\d+)?)\s*m?$/);
    return m ? round2(Number(m[1])) : null;
  }
  const inchesOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inchesOnly) return round2(Number(inchesOnly[1]) / 12);
  const ftIn = s.match(
    /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*[- ]?\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/,
  );
  if (!ftIn) return null;
  const feet = Number(ftIn[1]);
  const inches = ftIn[2] ? Number(ftIn[2]) : 0;
  if (inches >= 12 && ftIn[2]) return null;
  return round2(feet + inches / 12);
}

export function convertProperty(p: FieldProperty, units: Units): FieldProperty {
  if (p.units === units) return p;
  const f = units === "m" ? 0.3048 : 1 / 0.3048;
  const c = (n: number) => round2(n * f);
  return {
    ...p,
    units,
    rooms: p.rooms.map((r) => ({ ...r, points: r.points.map((q) => ({ x: c(q.x), y: c(q.y) })) })),
    openings: p.openings.map((o) => ({ ...o, offset: c(o.offset), width: c(o.width) })),
    stairs: p.stairs.map((s) => ({
      ...s,
      x: c(s.x),
      y: c(s.y),
      width: c(s.width),
      length: c(s.length),
    })),
  };
}

/** Defensive loader for saved / imported JSON. */
export function sanitizeProperty(value: unknown): FieldProperty | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<FieldProperty>;
  if (typeof v.id !== "string" || !Array.isArray(v.rooms)) return null;
  // Saves from before levels existed get a single "Main" level.
  const levels: FieldLevel[] = Array.isArray(v.levels)
    ? v.levels
        .filter((l) => l && typeof l.id === "string")
        .map((l) => ({ id: l.id, name: typeof l.name === "string" && l.name ? l.name : "Level" }))
    : [];
  if (levels.length === 0) levels.push({ id: "level-main", name: "Main" });
  const levelIds = new Set(levels.map((l) => l.id));
  const fallback = levels[0].id;
  const rooms: FieldRoom[] = [];
  for (const r of v.rooms) {
    if (!r || typeof r.id !== "string" || !Array.isArray(r.points)) continue;
    const points = r.points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length < 4) continue;
    rooms.push({
      id: r.id,
      name: typeof r.name === "string" ? r.name : "Room",
      points,
      photos: Array.isArray(r.photos)
        ? r.photos.filter((ph) => ph && typeof ph.thumb === "string").slice(0, MAX_PHOTOS_PER_ROOM)
        : [],
      notes: typeof r.notes === "string" ? r.notes : "",
      source: r.source ?? "draw",
      levelId: typeof r.levelId === "string" && levelIds.has(r.levelId) ? r.levelId : fallback,
    });
  }
  const ids = new Set(rooms.map((r) => r.id));
  return {
    id: v.id,
    name: typeof v.name === "string" ? v.name : "Property",
    address: typeof v.address === "string" ? v.address : "",
    units: v.units === "m" ? "m" : "ft",
    rooms,
    openings: Array.isArray(v.openings) ? v.openings.filter((o) => o && ids.has(o.roomId)) : [],
    levels,
    stairs: Array.isArray(v.stairs)
      ? v.stairs
          .map((s) => sanitizeStairs(s, levelIds, fallback))
          .filter((s): s is FieldStairs => Boolean(s))
      : [],
    createdAt: Number(v.createdAt) || Date.now(),
    updatedAt: Number(v.updatedAt) || Date.now(),
  };
}
