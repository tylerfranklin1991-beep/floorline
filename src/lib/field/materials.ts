/**
 * Floorline materials: square footage, carpet roll layout (drops, fills, seams),
 * baseboard / quarter round and doorway transitions. Pure and unit tested.
 *
 * Plan coordinates are in the property's units (ft or m). Roll widths and trim
 * allowances are stored in feet / inches so switching units never changes them.
 */
import {
  area,
  edges,
  levelView,
  openingSegment,
  round2,
  type FieldOpening,
  type FieldProperty,
  type FieldRoom,
  type FieldStairs,
  type Pt,
  type Units,
} from "./model.ts";

export type FloorMaterial = "carpet" | "hard" | "none";
export type TransitionType = "t-mold" | "reducer" | "threshold" | "carpet-tile" | "none";
export const TRANSITION_LABEL: Record<TransitionType, string> = {
  "t-mold": "T-mold",
  reducer: "Reducer",
  threshold: "Threshold",
  "carpet-tile": "Carpet-to-tile",
  none: "None",
};
export const ROLL_WIDTHS_FT = [12, 13.5, 15] as const;

export interface RoomFlooring {
  material: FloorMaterial;
  /** Roll width in feet (12, 13.5, 15). */
  rollWidthFt: number;
  /** Pile / roll direction in degrees: 0 = rolls run left-right, 90 = up-down (also 180/270). */
  pileDeg: number;
  /** Extra trim added to each end of every cut, inches. */
  trimIn: number;
  /** Waste allowance added to the order, percent. */
  wastePct: number;
  /** Walls (edge indexes) that get no baseboard, e.g. behind cabinets. */
  noBaseWalls: number[];
  quarterRound: boolean;
}

export const DEFAULT_FLOORING: RoomFlooring = {
  material: "carpet",
  rollWidthFt: 12,
  pileDeg: 0,
  trimIn: 3,
  wastePct: 5,
  noBaseWalls: [],
  quarterRound: false,
};

export function roomFlooring(r: FieldRoom): RoomFlooring {
  return { ...DEFAULT_FLOORING, ...(r.flooring ?? {}) };
}

const FT = 0.3048;
/** Feet expressed in the plan's units. */
export const ftToUnits = (ft: number, u: Units) => (u === "ft" ? ft : ft * FT);
/** Area in sq ft regardless of plan units. */
export const toSqFt = (a: number, u: Units) => (u === "ft" ? a : a / (FT * FT));

/* ------------------------------------------------------------------ area */

export const roomArea = (r: FieldRoom) => area(r.points);

/** Typical stair: 10" tread + 7.5" riser covered per step (carpet wraps both). */
export function stairsArea(s: FieldStairs, u: Units): number {
  if (!s.steps) return s.width * s.length;
  return s.steps * s.width * ftToUnits((10 + 7.5) / 12, u);
}

export type AreaSummary = {
  rooms: { id: string; name: string; levelId: string; area: number }[];
  levels: { id: string; name: string; area: number; stairsArea: number; steps: number }[];
  total: number;
  stairsArea: number;
  steps: number;
};

export function areaSummary(
  p: FieldProperty,
  includeStairs = p.includeStairs ?? false,
): AreaSummary {
  const rooms = p.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    levelId: r.levelId,
    area: roomArea(r),
  }));
  const levels = p.levels.map((l) => {
    const st = p.stairs.filter((s) => s.levelId === l.id);
    const sa = st.reduce((s, x) => s + stairsArea(x, p.units), 0);
    const roomsA = rooms.filter((r) => r.levelId === l.id).reduce((s, r) => s + r.area, 0);
    return {
      id: l.id,
      name: l.name,
      area: roomsA + (includeStairs ? sa : 0),
      stairsArea: sa,
      steps: st.reduce((s, x) => s + (x.steps ?? 0), 0),
    };
  });
  return {
    rooms,
    levels,
    total: levels.reduce((s, l) => s + l.area, 0),
    stairsArea: levels.reduce((s, l) => s + l.stairsArea, 0),
    steps: levels.reduce((s, l) => s + l.steps, 0),
  };
}

/* ---------------------------------------------------------- carpet layout */

type Iv = [number, number];
const EPS = 1e-7;

/** Rotate plan points so the roll length runs along +x. */
function toRollFrame(points: Pt[], deg: number): Pt[] {
  const vertical = Math.round(((deg % 180) + 180) % 180) === 90;
  return vertical ? points.map((q) => ({ x: q.y, y: -q.x })) : points;
}
function fromRollFrame(q: Pt, deg: number): Pt {
  const vertical = Math.round(((deg % 180) + 180) % 180) === 90;
  return vertical ? { x: -q.y, y: q.x } : q;
}

/** x-intervals of the polygon on the horizontal line y (even-odd scanline). */
export function crossSection(points: Pt[], y: number): Iv[] {
  const xs: number[] = [];
  for (const e of edges(points)) {
    const y0 = Math.min(e.a.y, e.b.y);
    const y1 = Math.max(e.a.y, e.b.y);
    if (y1 - y0 < EPS || y < y0 || y >= y1) continue;
    xs.push(e.a.x + ((y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y));
  }
  xs.sort((a, b) => a - b);
  const out: Iv[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1] - xs[i] > EPS) out.push([xs[i], xs[i + 1]]);
  return out;
}

function union(ivs: Iv[]): Iv[] {
  const s = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: Iv[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
function intersect(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const x of a)
    for (const y of b) {
      const lo = Math.max(x[0], y[0]);
      const hi = Math.min(x[1], y[1]);
      if (hi - lo > EPS) out.push([lo, hi]);
    }
  return out;
}

/** Union of the polygon's cross-sections across the band y0..y1 (with the actual y extent). */
function bandCoverage(
  points: Pt[],
  y0: number,
  y1: number,
): { iv: Iv; yMin: number; yMax: number }[] {
  const ys = [y0, y1, ...points.map((q) => q.y).filter((y) => y > y0 && y < y1)].sort(
    (a, b) => a - b,
  );
  const pieces: { iv: Iv; lo: number; hi: number }[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    if (ys[i + 1] - ys[i] < EPS) continue;
    for (const iv of crossSection(points, (ys[i] + ys[i + 1]) / 2))
      pieces.push({ iv, lo: ys[i], hi: ys[i + 1] });
  }
  return union(pieces.map((p) => p.iv)).map((iv) => {
    const inside = pieces.filter((p) => p.iv[0] < iv[1] - EPS && p.iv[1] > iv[0] + EPS);
    return {
      iv,
      yMin: Math.min(...inside.map((p) => p.lo)),
      yMax: Math.max(...inside.map((p) => p.hi)),
    };
  });
}

export type Cut = {
  roomId: string;
  /** Length along the roll including trim, plan units. */
  length: number;
  /** Width actually needed across the roll (≤ roll width), plan units. */
  width: number;
  /** True when the piece is narrower than the roll (a fill / partial width). */
  fill: boolean;
  /** Piece rectangle on the plan (without trim). */
  rect: { x: number; y: number; w: number; h: number };
};
export type Seam = { a: Pt; b: Pt };
export type CarpetLayout = {
  roomId: string;
  rollWidth: number;
  cuts: Cut[];
  seams: Seam[];
  /** Sum of cut lengths, plan units (before waste). */
  length: number;
};

/**
 * Lay a room out in roll-width strips running along the pile direction.
 * Strips start at the room's edge; each strip's covered span becomes one drop
 * (disjoint spans become separate drops). Seams are the strip boundaries that
 * have carpet on both sides.
 */
export function carpetLayout(room: FieldRoom, units: Units, f = roomFlooring(room)): CarpetLayout {
  const W = ftToUnits(f.rollWidthFt, units);
  const trim = ftToUnits(f.trimIn / 12, units);
  const pts = toRollFrame(room.points, f.pileDeg);
  const minY = Math.min(...pts.map((q) => q.y));
  const maxY = Math.max(...pts.map((q) => q.y));
  const cuts: Cut[] = [];
  const seams: Seam[] = [];
  const n = Math.max(1, Math.ceil((maxY - minY) / W - 1e-6));
  for (let i = 0; i < n; i++) {
    const y0 = minY + i * W;
    const y1 = Math.min(maxY, y0 + W);
    for (const c of bandCoverage(pts, y0, y1)) {
      const width = c.yMax - c.yMin;
      const a = fromRollFrame({ x: c.iv[0], y: c.yMin }, f.pileDeg);
      const b = fromRollFrame({ x: c.iv[1], y: c.yMax }, f.pileDeg);
      cuts.push({
        roomId: room.id,
        length: round2(c.iv[1] - c.iv[0] + 2 * trim),
        width: round2(width),
        fill: width < W - 1e-6,
        rect: {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x),
          h: Math.abs(b.y - a.y),
        },
      });
    }
    if (i > 0) {
      const both = intersect(crossSection(pts, y0 - 1e-4), crossSection(pts, y0 + 1e-4));
      for (const iv of union(both))
        seams.push({
          a: fromRollFrame({ x: iv[0], y: y0 }, f.pileDeg),
          b: fromRollFrame({ x: iv[1], y: y0 }, f.pileDeg),
        });
    }
  }
  return {
    roomId: room.id,
    rollWidth: W,
    cuts,
    seams,
    length: cuts.reduce((s, c) => s + c.length, 0),
  };
}

/** One length pulled off the roll; may carry several fills side by side. */
export type RollPiece = { length: number; cuts: Cut[]; usedWidth: number };

/**
 * Turn cuts into roll pieces. Full-width drops are their own piece. With
 * `reuseFills`, narrow fills are packed side by side (first-fit decreasing by
 * length) into a piece when their widths fit in the roll width, so leftover
 * from one fill covers another — across rooms when they share a roll width.
 */
export function packRoll(cuts: Cut[], rollWidth: number, reuseFills: boolean): RollPiece[] {
  const pieces: RollPiece[] = [];
  const fills: Cut[] = [];
  for (const c of cuts) {
    if (c.fill && reuseFills) fills.push(c);
    else pieces.push({ length: c.length, cuts: [c], usedWidth: c.width });
  }
  fills.sort((a, b) => b.length - a.length || b.width - a.width);
  const open: RollPiece[] = [];
  for (const c of fills) {
    const p = open.find((q) => q.usedWidth + c.width <= rollWidth + 1e-6);
    if (p) {
      p.cuts.push(c);
      p.usedWidth += c.width;
    } else open.push({ length: c.length, cuts: [c], usedWidth: c.width });
  }
  return [...pieces, ...open];
}

export type CarpetOrder = {
  rollWidthFt: number;
  pieces: RollPiece[];
  /** Linear length to order incl. waste, plan units (ft or m). */
  linear: number;
  /** Square yards (ft) or square metres (m) to order incl. waste. */
  yards: number;
};

/** Carpet to order, grouped by roll width. */
export function carpetOrder(p: FieldProperty): CarpetOrder[] {
  const byWidth = new Map<number, { cuts: Cut[]; waste: number[] }>();
  for (const r of p.rooms) {
    const f = roomFlooring(r);
    if (f.material !== "carpet") continue;
    const g = byWidth.get(f.rollWidthFt) ?? { cuts: [], waste: [] };
    const lay = carpetLayout(r, p.units, f);
    g.cuts.push(...lay.cuts);
    g.waste.push(...lay.cuts.map(() => f.wastePct));
    byWidth.set(f.rollWidthFt, g);
  }
  return [...byWidth.entries()].map(([wFt, g]) => {
    const W = ftToUnits(wFt, p.units);
    const pieces = packRoll(g.cuts, W, p.reuseFills ?? false);
    const waste = g.waste.length ? Math.max(...g.waste) : 0;
    const linear = round2(pieces.reduce((s, x) => s + x.length, 0) * (1 + waste / 100));
    const sq = linear * W;
    return {
      rollWidthFt: wFt,
      pieces,
      linear,
      yards: round2(p.units === "ft" ? sq / 9 : sq),
    };
  });
}

/* ------------------------------------------------------ baseboard / trim */

const isPassage = (o: FieldOpening) => o.kind !== "window";

/** Baseboard run for a room: perimeter minus excluded walls minus doorway widths. */
export function baseboard(p: FieldProperty, room: FieldRoom): number {
  const f = roomFlooring(room);
  const skip = new Set(f.noBaseWalls);
  let total = 0;
  for (const e of edges(room.points)) if (!skip.has(e.index)) total += e.length;
  for (const o of p.openings) {
    if (o.roomId !== room.id || !isPassage(o) || skip.has(o.wall)) continue;
    const seg = openingSegment(room, o);
    if (seg) total -= Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  }
  return Math.max(0, round2(total));
}

/* ------------------------------------------------------------ transitions */

export type Transition = {
  openingId: string;
  roomId: string;
  /** Room on the other side, if a doorway of another room lines up. */
  otherRoomId: string | null;
  /** The other room's matching opening, if any. */
  twinOpeningId: string | null;
  type: TransitionType;
  auto: boolean;
  width: number;
  at: Pt;
};

function defaultTransition(a: FloorMaterial, b: FloorMaterial | null): TransitionType {
  if (b === null) return "threshold";
  if (a === b) return a === "carpet" ? "none" : "t-mold";
  if (a === "carpet" || b === "carpet") return "carpet-tile";
  return "reducer";
}

/**
 * One transition per doorway (doors and open doorways; not windows). Two rooms'
 * doorways that line up (centres within ~1 ft) are the same doorway and count once.
 */
export function transitions(p: FieldProperty): Transition[] {
  const near = ftToUnits(1, p.units);
  const segs = p.openings
    .filter(isPassage)
    .map((o) => {
      const room = p.rooms.find((r) => r.id === o.roomId);
      const seg = room && openingSegment(room, o);
      return room && seg ? { o, room, seg } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const used = new Set<string>();
  const out: Transition[] = [];
  for (const s of segs) {
    if (used.has(s.o.id)) continue;
    used.add(s.o.id);
    const twin = segs.find(
      (t) =>
        !used.has(t.o.id) &&
        t.room.id !== s.room.id &&
        t.room.levelId === s.room.levelId &&
        Math.hypot(t.seg.c.x - s.seg.c.x, t.seg.c.y - s.seg.c.y) <= near,
    );
    if (twin) used.add(twin.o.id);
    const chosen = s.o.transition ?? twin?.o.transition;
    const auto = defaultTransition(
      roomFlooring(s.room).material,
      twin ? roomFlooring(twin.room).material : null,
    );
    out.push({
      openingId: s.o.id,
      roomId: s.room.id,
      otherRoomId: twin?.room.id ?? null,
      twinOpeningId: twin?.o.id ?? null,
      type: chosen ?? auto,
      auto: !chosen,
      width: round2(Math.hypot(s.seg.b.x - s.seg.a.x, s.seg.b.y - s.seg.a.y)),
      at: s.seg.c,
    });
  }
  return out;
}

/* --------------------------------------------------------------- summary */

export type Materials = {
  area: AreaSummary;
  carpet: CarpetOrder[];
  rooms: {
    room: FieldRoom;
    area: number;
    flooring: RoomFlooring;
    baseboard: number;
    quarterRound: number;
    layout: CarpetLayout | null;
  }[];
  baseboard: number;
  quarterRound: number;
  transitions: Transition[];
  transitionTotals: { type: TransitionType; count: number; length: number }[];
};

export function materials(full: FieldProperty, levelId?: string): Materials {
  const p = levelId
    ? { ...levelView(full, levelId), levels: full.levels.filter((l) => l.id === levelId) }
    : full;
  const rooms = p.rooms.map((room) => {
    const f = roomFlooring(room);
    const bb = f.material === "none" ? 0 : baseboard(p, room);
    return {
      room,
      area: roomArea(room),
      flooring: f,
      baseboard: bb,
      quarterRound: f.quarterRound ? bb : 0,
      layout: f.material === "carpet" ? carpetLayout(room, p.units, f) : null,
    };
  });
  const tr = transitions(p);
  const totals = new Map<TransitionType, { count: number; length: number }>();
  for (const t of tr) {
    if (t.type === "none") continue;
    const g = totals.get(t.type) ?? { count: 0, length: 0 };
    g.count += 1;
    g.length = round2(g.length + t.width);
    totals.set(t.type, g);
  }
  return {
    area: areaSummary(p),
    carpet: carpetOrder(p),
    rooms,
    baseboard: round2(rooms.reduce((s, r) => s + r.baseboard, 0)),
    quarterRound: round2(rooms.reduce((s, r) => s + r.quarterRound, 0)),
    transitions: tr,
    transitionTotals: [...totals.entries()].map(([type, g]) => ({ type, ...g })),
  };
}

/** "123.4 SY" or "12.3 m²" for carpet order quantities. */
export function formatYards(n: number, u: Units) {
  return u === "ft"
    ? `${(Math.ceil(n * 10) / 10).toFixed(1)} SY`
    : `${(Math.ceil(n * 10) / 10).toFixed(1)} m²`;
}
export function formatLinear(n: number, u: Units) {
  return u === "ft" ? `${Math.ceil(n * 10) / 10} LF` : `${Math.ceil(n * 100) / 100} lm`;
}
