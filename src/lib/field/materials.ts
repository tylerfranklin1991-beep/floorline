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
import { jobSettings, type JobSettings } from "./job.ts";

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
  /**
   * Carpet: where the first seam falls, feet from the starting wall (0 = a full
   * roll width against the wall). Slides every seam in the room.
   */
  seamOffsetFt: number;
  /** LVP plank direction: 0 = planks run left-right, 90 = up-down. */
  plankDeg: number;
}

export const MATERIAL_LABEL: Record<FloorMaterial, string> = {
  carpet: "Carpet",
  hard: "LVP",
  none: "No floor",
};

export const DEFAULT_FLOORING: RoomFlooring = {
  material: "carpet",
  rollWidthFt: 12,
  pileDeg: 0,
  trimIn: 3,
  wastePct: 5,
  noBaseWalls: [],
  quarterRound: false,
  seamOffsetFt: 0,
  plankDeg: 0,
};

/**
 * A room's flooring with job defaults filled in: roll width, trim and waste come
 * from the job unless the room overrides them (waste follows the material:
 * LVP waste vs carpet waste).
 */
export function roomFlooring(r: FieldRoom, job?: Partial<JobSettings>): RoomFlooring {
  const j = jobSettings(job);
  const saved = (r.flooring ?? {}) as Partial<RoomFlooring>;
  const material = saved.material ?? DEFAULT_FLOORING.material;
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return {
    ...DEFAULT_FLOORING,
    ...saved,
    material,
    rollWidthFt: fin(saved.rollWidthFt) && saved.rollWidthFt! > 0 ? saved.rollWidthFt! : j.rollWidthFt,
    trimIn: fin(saved.trimIn) ? saved.trimIn! : j.trimIn,
    wastePct: fin(saved.wastePct)
      ? saved.wastePct!
      : material === "carpet"
        ? j.carpetWastePct
        : material === "hard"
          ? j.lvpWastePct
          : 0,
    seamOffsetFt: fin(saved.seamOffsetFt) ? saved.seamOffsetFt! : 0,
    plankDeg: fin(saved.plankDeg) ? saved.plankDeg! : 0,
    noBaseWalls: Array.isArray(saved.noBaseWalls) ? saved.noBaseWalls : [],
  };
}

/** True when the room sets its own waste instead of using the job default. */
export const wasteOverridden = (r: FieldRoom) =>
  typeof r.flooring?.wastePct === "number" && Number.isFinite(r.flooring.wastePct);

const FT = 0.3048;
/** Feet expressed in the plan's units. */
export const ftToUnits = (ft: number, u: Units) => (u === "ft" ? ft : ft * FT);
/** Area in sq ft regardless of plan units. */
export const toSqFt = (a: number, u: Units) => (u === "ft" ? a : a / (FT * FT));

/* ------------------------------------------------------------------ area */

/** Floor area: outline, minus exclusions (islands, cabinets, hearths), plus add-on areas. */
export const roomArea = (r: FieldRoom) => {
  let a = area(r.points);
  for (const x of r.areas ?? []) a += (x.kind === "add" ? 1 : -1) * x.w * x.l;
  return Math.max(0, a);
};
export const excludedArea = (r: FieldRoom) =>
  (r.areas ?? []).filter((x) => x.kind === "exclude").reduce((s, x) => s + x.w * x.l, 0);

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
  /** Name of an add-on area this piece covers. */
  label?: string;
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
  // Seam offset: the first seam sits `off` from the starting wall (0 = full width).
  const off = seamShift(f.seamOffsetFt, units, W);
  let y0 = off > 1e-6 ? minY + off - W : minY;
  let first = true;
  while (y0 < maxY - 1e-6) {
    const lo = Math.max(minY, y0);
    const y1 = Math.min(maxY, y0 + W);
    for (const c of bandCoverage(pts, lo, y1)) {
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
    if (!first) {
      const both = intersect(crossSection(pts, lo - 1e-4), crossSection(pts, lo + 1e-4));
      for (const iv of union(both))
        seams.push({
          a: fromRollFrame({ x: iv[0], y: lo }, f.pileDeg),
          b: fromRollFrame({ x: iv[1], y: lo }, f.pileDeg),
        });
    }
    first = false;
    y0 += W;
  }
  // Add-on areas (closet, bay) not drawn in the outline: their own pieces.
  for (const x of room.areas ?? []) {
    if (x.kind !== "add") continue;
    const across = Math.min(x.w, x.l);
    const along = Math.max(x.w, x.l);
    let left = across;
    while (left > 1e-6) {
      const width = Math.min(W, left);
      cuts.push({
        roomId: room.id,
        length: round2(along + 2 * trim),
        width: round2(width),
        fill: width < W - 1e-6,
        rect: { x: 0, y: 0, w: 0, h: 0 },
        label: x.name,
      });
      left -= width;
    }
  }
  return {
    roomId: room.id,
    rollWidth: W,
    cuts,
    seams,
    length: round2(cuts.reduce((s, c) => s + c.length, 0)),
  };
}

/** Seam offset in plan units, wrapped into 0..W. */
export function seamShift(offsetFt: number, units: Units, W: number): number {
  const o = ftToUnits(offsetFt || 0, units);
  return ((o % W) + W) % W;
}

/** Offsets (ft) for the seam presets: against the start wall, centred, against the far wall. */
export function seamPresets(room: FieldRoom, f: RoomFlooring, units: Units) {
  const pts = toRollFrame(room.points, f.pileDeg);
  const span = Math.max(...pts.map((q) => q.y)) - Math.min(...pts.map((q) => q.y));
  const W = ftToUnits(f.rollWidthFt, units);
  const toFt = (n: number) => round2(units === "ft" ? n : n / FT);
  const rem = span % W;
  const n = Math.ceil(span / W - 1e-6);
  // Centred: equal fills on both sides.
  const centre = n <= 1 ? 0 : (W - (n * W - span) / 2) % W;
  return { start: 0, centre: toFt(centre), far: toFt(rem < 1e-6 ? 0 : rem), spanFt: toFt(span) };
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
  /** Room carpet linear length incl. waste, plan units (ft or m). */
  roomsLinear: number;
  /** Stair carpet linear length incl. waste, plan units. */
  stairsLinear: number;
  /** Total linear length to order incl. waste, plan units (ft or m). */
  linear: number;
  /** Square yards (ft) or square metres (m) to order incl. waste. */
  yards: number;
};

/** Carpet to order, grouped by roll width. Waste follows each room's setting. */
export function carpetOrder(p: FieldProperty): CarpetOrder[] {
  const job = jobSettings(p.job);
  const byWidth = new Map<number, { cuts: Cut[]; stairs: number }>();
  const wasteOf = new Map<string, number>();
  for (const r of p.rooms) {
    const f = roomFlooring(r, p.job);
    if (f.material !== "carpet") continue;
    const g = byWidth.get(f.rollWidthFt) ?? { cuts: [], stairs: 0 };
    g.cuts.push(...carpetLayout(r, p.units, f).cuts);
    wasteOf.set(r.id, f.wastePct);
    byWidth.set(f.rollWidthFt, g);
  }
  const st = stairCarpet(p);
  if (st.length) {
    const g = byWidth.get(job.rollWidthFt) ?? { cuts: [], stairs: 0 };
    g.stairs += st.reduce((s, x) => s + x.linear, 0);
    byWidth.set(job.rollWidthFt, g);
  }
  return [...byWidth.entries()].map(([wFt, g]) => {
    const W = ftToUnits(wFt, p.units);
    const pieces = packRoll(g.cuts, W, p.reuseFills ?? false);
    const roomsLinear = round2(
      pieces.reduce(
        (s, x) => s + x.length * (1 + Math.max(...x.cuts.map((c) => wasteOf.get(c.roomId) ?? 0)) / 100),
        0,
      ),
    );
    const stairsLinear = round2(g.stairs * (1 + job.carpetWastePct / 100));
    const linear = round2(roomsLinear + stairsLinear);
    const sq = linear * W;
    return {
      rollWidthFt: wFt,
      pieces,
      roomsLinear,
      stairsLinear,
      linear,
      yards: round2(p.units === "ft" ? sq / 9 : sq),
    };
  });
}

/* ------------------------------------------------------------ stair carpet */

export type StairCut = {
  stairsId: string;
  levelId: string;
  steps: number;
  style: "box" | "waterfall";
  /** Per-step piece, inches: across the stair × along the roll (tread + riser + wrap). */
  pieceWidthIn: number;
  pieceLengthIn: number;
  /** Steps that fit side by side across the roll. */
  perRow: number;
  rows: number;
  /** Length off the roll before waste, plan units. */
  linear: number;
  /** Carpet area of the steps, sq ft. */
  sqft: number;
};

/** Wrap allowance per step (inches): box / capped ≈ 3", waterfall ≈ 2". */
export const STAIR_WRAP_IN = { box: 3, waterfall: 2 } as const;

/**
 * Per-step stair carpet cuts. Pile runs down the stairs, so each step piece is
 * the stair width across the roll and tread + riser + wrap along it; as many
 * steps as fit sit side by side across the roll width.
 */
export function stairCarpetFor(s: FieldStairs, units: Units, job: JobSettings): StairCut | null {
  if (s.carpet === false || !s.steps) return null;
  const style = s.style ?? job.stairStyle;
  const tread = s.treadIn ?? job.treadIn;
  const riser = s.riserIn ?? job.riserIn;
  const widthIn = round2((units === "ft" ? s.width : s.width / FT) * 12);
  const pieceLengthIn = round2(tread + riser + STAIR_WRAP_IN[style]);
  const rollIn = job.rollWidthFt * 12;
  const perRow = Math.max(1, Math.floor((rollIn + 1e-6) / Math.max(1, widthIn)));
  const rows = Math.ceil(s.steps / perRow);
  const linearFt = (rows * pieceLengthIn) / 12;
  return {
    stairsId: s.id,
    levelId: s.levelId,
    steps: s.steps,
    style,
    pieceWidthIn: widthIn,
    pieceLengthIn,
    perRow,
    rows,
    linear: round2(ftToUnits(linearFt, units)),
    sqft: round2((s.steps * widthIn * pieceLengthIn) / 144),
  };
}
export function stairCarpet(p: FieldProperty): StairCut[] {
  const job = jobSettings(p.job);
  return p.stairs
    .map((s) => stairCarpetFor(s, p.units, job))
    .filter((x): x is StairCut => Boolean(x));
}

/* --------------------------------------------------------------- LVP, pad */

export type LvpOrder = {
  /** Net floor sq ft (after exclusions). */
  sqft: number;
  /** Sq ft including each room's waste. */
  withWaste: number;
  /** Boxes rounded up, or null when box coverage isn't set. */
  boxes: number | null;
  boxSqFt: number;
};

/** Whole boxes for an area (with waste already applied). */
export function boxesFor(sqftWithWaste: number, boxSqFt: number): number | null {
  if (!(boxSqFt > 0)) return null;
  return Math.ceil(sqftWithWaste / boxSqFt - 1e-9);
}

export function lvpOrder(p: FieldProperty): LvpOrder {
  const job = jobSettings(p.job);
  let sqft = 0;
  let withWaste = 0;
  for (const r of p.rooms) {
    const f = roomFlooring(r, p.job);
    if (f.material !== "hard") continue;
    const a = toSqFt(roomArea(r), p.units);
    sqft += a;
    withWaste += a * (1 + f.wastePct / 100);
  }
  return {
    sqft: round2(sqft),
    withWaste: round2(withWaste),
    boxes: sqft > 0 ? boxesFor(withWaste, job.lvpBoxSqFt) : 0,
    boxSqFt: job.lvpBoxSqFt,
  };
}

/** Pad under carpet: carpet rooms (net) + carpeted stairs, plus pad waste, in SY. */
export function padOrder(p: FieldProperty): { sqft: number; sy: number } {
  const job = jobSettings(p.job);
  if (!job.pad) return { sqft: 0, sy: 0 };
  let sqft = 0;
  for (const r of p.rooms)
    if (roomFlooring(r, p.job).material === "carpet") sqft += toSqFt(roomArea(r), p.units);
  sqft += stairCarpet(p).reduce((s, x) => s + x.sqft, 0);
  return {
    sqft: round2(sqft),
    sy: sqft > 0 ? Math.ceil(((sqft / 9) * (1 + job.padWastePct / 100)) * 10 - 1e-9) / 10 : 0,
  };
}

/* ------------------------------------------------------ baseboard / trim */

const isPassage = (o: FieldOpening) => o.kind !== "window";

/** Baseboard run for a room: perimeter minus excluded walls minus doorway widths. */
export function baseboard(p: FieldProperty, room: FieldRoom): number {
  const f = roomFlooring(room, p.job);
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
      roomFlooring(s.room, p.job).material,
      twin ? roomFlooring(twin.room, p.job).material : null,
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
  lvp: LvpOrder;
  pad: { sqft: number; sy: number };
  stairs: StairCut[];
};

export function materials(full: FieldProperty, levelId?: string): Materials {
  const p = levelId
    ? { ...levelView(full, levelId), levels: full.levels.filter((l) => l.id === levelId) }
    : full;
  const rooms = p.rooms.map((room) => {
    const f = roomFlooring(room, p.job);
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
    lvp: lvpOrder(p),
    pad: padOrder(p),
    stairs: stairCarpet(p),
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
