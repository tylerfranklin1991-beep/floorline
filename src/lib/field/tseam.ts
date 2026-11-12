/**
 * Carpet roll layout with T-seam fills.
 *
 * Drops run the way the pile runs. A strip narrower than the roll is a fill.
 * A long fill is cross-cut into pieces (every roll width, or every pattern
 * repeat) and those pieces are joined to each other with T-seams. Every piece
 * keeps the same pile direction — fills are not turned 90°.
 *
 * The older `carpetLayout` is unchanged. This is a separate cut list.
 */
import {
  billableArea,
  crossSection,
  ftToUnits,
  roomFlooring,
  seamShift,
  toSqFt,
} from "./materials.ts";
import {
  area,
  bbox,
  pointInPolygon,
  type FieldProperty,
  type FieldRoom,
  type Pt,
  type Units,
} from "./model.ts";

const EPS = 1e-6;

export type TseamPiece = {
  n: number;
  roomId: string;
  roomName: string;
  /** Across the roll, feet. */
  widthFt: number;
  /** Along the pile, feet, before trim. */
  lengthFt: number;
  /** Along the pile including trim on both ends, feet. */
  cutLengthFt: number;
  fill: boolean;
  /** Plan polygon. Empty for an add-on area that has no drawn outline. */
  corners: Pt[];
  /** Unit vector of the pile, in plan coordinates. */
  pile: Pt;
};

export type TseamMark = {
  a: Pt;
  b: Pt;
  kind: "seam" | "t";
  /** Rooms whose seam offset this line slides. */
  roomIds: string[];
};

export type TseamLayout = {
  pileDeg: 0 | 90;
  pieces: TseamPiece[];
  marks: TseamMark[];
  /** Floor area being covered, sq ft. */
  netSf: number;
  /** Roll length × roll width, sq ft (includes trim). */
  orderedSf: number;
  /** Roll length to order, feet. */
  linearFt: number;
  /** Ordered square yards (linear × width / 9). */
  sqYd: number;
  /** (ordered − net) / ordered, percent. */
  wastePct: number;
};

export type TseamOptions = {
  units: Units;
  rollWidthFt: number;
  trimIn: number;
  /** Inches. 0 = cross-join a fill every roll width. */
  patternRepeatIn: number;
  pileDeg: 0 | 90 | "auto";
  seamOffsetFt: number;
  roomId: string;
  roomName: string;
  /** Override the polygon area (closets, exclusions). */
  netSf?: number;
  roomIds?: string[];
};

type Iv = [number, number];

function toRoll(points: Pt[], pile: 0 | 90): Pt[] {
  return pile === 90 ? points.map((q) => ({ x: q.y, y: -q.x })) : points;
}
function fromRoll(q: Pt, pile: 0 | 90): Pt {
  return pile === 90 ? { x: -q.y, y: q.x } : q;
}

function unionIv(ivs: Iv[]): Iv[] {
  const s = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: Iv[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
function intersectIv(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const x of a)
    for (const y of b) {
      const lo = Math.max(x[0], y[0]);
      const hi = Math.min(x[1], y[1]);
      if (hi - lo > EPS) out.push([lo, hi]);
    }
  return out;
}

function bandCoverage(points: Pt[], y0: number, y1: number): { iv: Iv; yMin: number; yMax: number }[] {
  const ys = [y0, y1, ...points.map((q) => q.y).filter((y) => y > y0 && y < y1)].sort((a, b) => a - b);
  const pieces: { iv: Iv; lo: number; hi: number }[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    if (ys[i + 1] - ys[i] < EPS) continue;
    for (const iv of crossSection(points, (ys[i] + ys[i + 1]) / 2))
      pieces.push({ iv, lo: ys[i], hi: ys[i + 1] });
  }
  return unionIv(pieces.map((p) => p.iv)).map((iv) => {
    const inside = pieces.filter((p) => p.iv[0] < iv[1] - EPS && p.iv[1] > iv[0] + EPS);
    return {
      iv,
      yMin: Math.min(...inside.map((p) => p.lo)),
      yMax: Math.max(...inside.map((p) => p.hi)),
    };
  });
}

function splitLen(len: number, step: number): number[] {
  if (!(step > EPS) || len <= step + 1e-4) return [round4(len)];
  const out: number[] = [];
  let left = len;
  while (left > step + 1e-4) {
    out.push(step);
    left -= step;
  }
  if (left > 1e-3) out.push(left);
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function toFt(units: Units, plan: number): number {
  return units === "ft" ? plan : plan / 0.3048;
}

export function emptyLayout(pile: 0 | 90 = 0): TseamLayout {
  return { pileDeg: pile, pieces: [], marks: [], netSf: 0, orderedSf: 0, linearFt: 0, sqYd: 0, wastePct: 0 };
}

/** Pack fill pieces side by side on the roll. Full-width drops each take their own length. */
export function rollLinearFt(pieces: Pick<TseamPiece, "fill" | "widthFt" | "cutLengthFt">[], rollWidthFt: number): number {
  let full = 0;
  const fills: { w: number; l: number }[] = [];
  for (const p of pieces) {
    if (!p.fill || p.widthFt >= rollWidthFt - 0.01) full += p.cutLengthFt;
    else fills.push({ w: p.widthFt, l: p.cutLengthFt });
  }
  const rows: { used: number; len: number }[] = [];
  for (const f of [...fills].sort((a, b) => b.l - a.l || b.w - a.w)) {
    const row = rows.find((r) => r.used + f.w <= rollWidthFt + 0.02);
    if (row) {
      row.used += f.w;
      row.len = Math.max(row.len, f.l);
    } else rows.push({ used: f.w, len: f.l });
  }
  return round2(full + rows.reduce((s, r) => s + r.len, 0));
}

function finish(pieces: TseamPiece[], marks: TseamMark[], pile: 0 | 90, netSf: number, rollWidthFt: number): TseamLayout {
  const linearFt = rollLinearFt(pieces, rollWidthFt);
  const orderedSf = round2(linearFt * rollWidthFt);
  const wastePct = orderedSf > 0.01 ? round2(Math.max(0, ((orderedSf - netSf) / orderedSf) * 100)) : 0;
  return {
    pileDeg: pile,
    pieces,
    marks,
    netSf: round2(netSf),
    orderedSf,
    linearFt,
    sqYd: round2(orderedSf / 9),
    wastePct,
  };
}

function layoutFixed(points: Pt[], opt: TseamOptions & { pileDeg: 0 | 90 }): TseamLayout {
  const pile = opt.pileDeg;
  if (points.length < 3) return emptyLayout(pile);
  const rollPts = toRoll(points, pile);
  const minY = Math.min(...rollPts.map((q) => q.y));
  const maxY = Math.max(...rollPts.map((q) => q.y));
  const W = ftToUnits(opt.rollWidthFt, opt.units);
  const trim = ftToUnits(opt.trimIn / 12, opt.units);
  const repeat =
    opt.patternRepeatIn > 0 ? ftToUnits(opt.patternRepeatIn / 12, opt.units) : W;
  const off = seamShift(opt.seamOffsetFt, opt.units, W);
  const roomIds = opt.roomIds ?? [opt.roomId];
  const pileVec = pile === 90 ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const pieces: TseamPiece[] = [];
  const marks: TseamMark[] = [];
  let n = 1;
  let y0 = off > 1e-6 ? minY + off - W : minY;
  let first = true;
  while (y0 < maxY - 1e-6) {
    const lo = Math.max(minY, y0);
    const y1 = Math.min(maxY, y0 + W);
    if (y1 - lo > 1e-4) {
      for (const c of bandCoverage(rollPts, lo, y1)) {
        const width = c.yMax - c.yMin;
        const len = c.iv[1] - c.iv[0];
        if (width < 1e-3 || len < 1e-3) continue;
        const fill = width < W - 1e-4;
        const chunks = fill ? splitLen(len, repeat) : [len];
        let x = c.iv[0];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const xh = x + chunk;
          if (fill && i > 0) {
            marks.push({
              a: fromRoll({ x, y: c.yMin }, pile),
              b: fromRoll({ x, y: c.yMax }, pile),
              kind: "t",
              roomIds,
            });
          }
          pieces.push({
            n: n++,
            roomId: opt.roomId,
            roomName: opt.roomName,
            widthFt: round2(toFt(opt.units, width)),
            lengthFt: round2(toFt(opt.units, chunk)),
            cutLengthFt: round2(toFt(opt.units, chunk + 2 * trim)),
            fill,
            corners: [
              fromRoll({ x, y: c.yMin }, pile),
              fromRoll({ x: xh, y: c.yMin }, pile),
              fromRoll({ x: xh, y: c.yMax }, pile),
              fromRoll({ x, y: c.yMax }, pile),
            ],
            pile: pileVec,
          });
          x = xh;
        }
      }
    }
    if (!first) {
      const both = unionIv(intersectIv(crossSection(rollPts, lo - 1e-4), crossSection(rollPts, lo + 1e-4)));
      for (const iv of both)
        marks.push({
          a: fromRoll({ x: iv[0], y: lo }, pile),
          b: fromRoll({ x: iv[1], y: lo }, pile),
          kind: "seam",
          roomIds,
        });
    }
    first = false;
    y0 += W;
  }
  const net = opt.netSf ?? round2(toSqFt(Math.abs(area(points)), opt.units));
  return finish(pieces, marks, pile, net, opt.rollWidthFt);
}

/** Lay out one polygon. `"auto"` picks the pile with less waste, then fewer seams. */
export function layoutTseam(points: Pt[], opt: TseamOptions): TseamLayout {
  if (opt.pileDeg !== "auto") return layoutFixed(points, { ...opt, pileDeg: opt.pileDeg });
  const a = layoutFixed(points, { ...opt, pileDeg: 0 });
  const b = layoutFixed(points, { ...opt, pileDeg: 90 });
  const score = (l: TseamLayout) =>
    l.wastePct * 1000 + l.marks.length * 10 + l.pieces.length;
  return score(a) <= score(b) ? a : b;
}

/* ------------------------------------------------------- touching rooms */

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function asRect(points: Pt[]): Box | null {
  if (points.length < 4) return null;
  const b = bbox(points);
  const boxA = (b.maxX - b.minX) * (b.maxY - b.minY);
  if (boxA < EPS) return null;
  if (Math.abs(Math.abs(area(points)) - boxA) > 0.05) return null;
  return b;
}

function touches(a: Box, b: Box, gap: number): boolean {
  const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const xGap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  const yGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY);
  return (xGap <= gap && yOverlap > 0.25) || (yGap <= gap && xOverlap > 0.25);
}

function keyPt(p: Pt): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
}
function parsePt(k: string): Pt {
  const [x, y] = k.split(",").map(Number);
  return { x: x / 1000, y: y / 1000 };
}

function symDiff(a: Iv[], b: Iv[]): Iv[] {
  const stops = [...a.flat(), ...b.flat()];
  const xs = [...new Set(stops.map((n) => Math.round(n * 1000) / 1000))].sort((p, q) => p - q);
  const out: Iv[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    if (xs[i + 1] - xs[i] < 1e-4) continue;
    const mid = (xs[i] + xs[i + 1]) / 2;
    const inA = a.some((s) => mid > s[0] + 1e-6 && mid < s[1] - 1e-6);
    const inB = b.some((s) => mid > s[0] + 1e-6 && mid < s[1] - 1e-6);
    if (inA !== inB) out.push([xs[i], xs[i + 1]]);
  }
  return out;
}

function covered(rects: Box[], at: number, axis: "x" | "y"): Iv[] {
  const ys: Iv[] = [];
  for (const r of rects) {
    const lo = axis === "x" ? r.minX : r.minY;
    const hi = axis === "x" ? r.maxX : r.maxY;
    if (lo < at && hi > at) ys.push(axis === "x" ? [r.minY, r.maxY] : [r.minX, r.maxX]);
  }
  return unionIv(ys);
}

/** Outline of the union of touching rectangles. Null if the stitch fails. */
export function unionRectOutline(rects: Box[]): Pt[] | null {
  if (rects.length === 0) return null;
  if (rects.length === 1) {
    const r = rects[0];
    return [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ];
  }
  const xs = [...new Set(rects.flatMap((r) => [round4(r.minX), round4(r.maxX)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [round4(r.minY), round4(r.maxY)]))].sort((a, b) => a - b);
  const adj = new Map<string, Pt[]>();
  const link = (a: Pt, b: Pt) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-4) return;
    const ka = keyPt(a);
    const kb = keyPt(b);
    adj.set(ka, [...(adj.get(ka) ?? []), b]);
    adj.set(kb, [...(adj.get(kb) ?? []), a]);
  };
  for (const x of xs) {
    for (const [y0, y1] of symDiff(covered(rects, x - 1e-3, "x"), covered(rects, x + 1e-3, "x")))
      link({ x, y: y0 }, { x, y: y1 });
  }
  for (const y of ys) {
    for (const [x0, x1] of symDiff(covered(rects, y - 1e-3, "y"), covered(rects, y + 1e-3, "y")))
      link({ x: x0, y }, { x: x1, y });
  }
  if (adj.size < 4) return null;
  const start = parsePt([...adj.keys()].sort()[0]);
  const poly: Pt[] = [start];
  let prev: Pt | null = null;
  let cur = start;
  for (let guard = 0; guard < 800; guard++) {
    const nexts = (adj.get(keyPt(cur)) ?? []).filter((n) => !prev || keyPt(n) !== keyPt(prev));
    if (!nexts.length) return null;
    const nxt = nexts[0];
    if (keyPt(nxt) === keyPt(start)) break;
    poly.push(nxt);
    prev = cur;
    cur = nxt;
  }
  if (poly.length < 4) return null;
  const sum = rects.reduce((s, r) => s + (r.maxX - r.minX) * (r.maxY - r.minY), 0);
  const a = Math.abs(area(poly));
  if (a < sum * 0.5 || a > sum * 1.02) return null;
  return poly;
}

export type CarpetPlan = {
  title: string;
  roomIds: string[];
  levelId: string;
  points: Pt[];
  layout: TseamLayout;
};

function carpetCandidates(p: FieldProperty): FieldRoom[] {
  return p.rooms.filter((r) => {
    if (r.points.length < 3) return false;
    if (roomFlooring(r, p.job).material === "carpet") return true;
    if (r.closet?.includeInParent) {
      const parent = p.rooms.find((x) => x.id === r.closet!.parentId);
      return Boolean(parent && roomFlooring(parent, p.job).material === "carpet");
    }
    return false;
  });
}

function polyNet(room: FieldRoom, units: Units): number {
  let a = Math.abs(area(room.points));
  for (const x of room.areas ?? []) a += (x.kind === "add" ? 1 : -1) * x.w * x.l;
  return Math.max(0, toSqFt(a, units));
}

type Cluster = { rooms: FieldRoom[]; points: Pt[] };

function clustersOf(p: FieldProperty, rooms: FieldRoom[]): Cluster[] {
  const gap = ftToUnits(0.25, p.units);
  const byLevel = new Map<string, FieldRoom[]>();
  for (const r of rooms) {
    const list = byLevel.get(r.levelId) ?? [];
    list.push(r);
    byLevel.set(r.levelId, list);
  }
  const out: Cluster[] = [];
  for (const list of byLevel.values()) {
    if (!p.combineCarpet) {
      for (const r of list) out.push({ rooms: [r], points: r.points });
      continue;
    }
    const used = new Set<string>();
    for (const seed of list) {
      if (used.has(seed.id)) continue;
      const group = [seed];
      used.add(seed.id);
      let grew = true;
      while (grew) {
        grew = false;
        for (const other of list) {
          if (used.has(other.id)) continue;
          const boxes = group.map((r) => asRect(r.points));
          const ob = asRect(other.points);
          if (boxes.some((b) => b === null) || !ob) continue;
          if (boxes.some((b) => b && touches(b, ob, gap))) {
            group.push(other);
            used.add(other.id);
            grew = true;
          }
        }
      }
      const rects = group.map((r) => asRect(r.points));
      if (group.length > 1 && rects.every((b): b is Box => Boolean(b))) {
        const outline = unionRectOutline(rects as Box[]);
        out.push({ rooms: group, points: outline ?? group[0].points });
        if (!outline) {
          out.pop();
          for (const r of group) out.push({ rooms: [r], points: r.points });
        }
      } else {
        for (const r of group) out.push({ rooms: [r], points: r.points });
      }
    }
  }
  return out;
}

function addonPieces(room: FieldRoom, opt: TseamOptions, pile: Pt, start: number): TseamPiece[] {
  const W = opt.rollWidthFt;
  const trimFt = (opt.trimIn / 12) * 2;
  const out: TseamPiece[] = [];
  let n = start;
  for (const x of room.areas ?? []) {
    if (x.kind !== "add") continue;
    const across = toFt(opt.units, Math.min(x.w, x.l));
    const along = toFt(opt.units, Math.max(x.w, x.l));
    let left = across;
    while (left > 0.01) {
      const width = Math.min(W, left);
      out.push({
        n: n++,
        roomId: room.id,
        roomName: x.name || room.name,
        widthFt: round2(width),
        lengthFt: round2(along),
        cutLengthFt: round2(along + trimFt),
        fill: width < W - 0.01,
        corners: [],
        pile,
      });
      left -= width;
    }
  }
  return out;
}

/**
 * One layout per carpeted room. With `combineCarpet`, rectangles that touch
 * (rooms, halls, closets) are laid as a single outline. Included closets of a
 * carpet room are carpet even when their own material is "none".
 */
export function carpetPlans(p: FieldProperty): CarpetPlan[] {
  const rooms = carpetCandidates(p);
  const plans: CarpetPlan[] = [];
  let n = 1;
  for (const cluster of clustersOf(p, rooms)) {
    const lead = cluster.rooms[0];
    const f = roomFlooring(lead, p.job);
    const repeat = Math.max(
      0,
      ...cluster.rooms.map((r) => {
        const v = r.flooring?.patternRepeatIn;
        return typeof v === "number" && v > 0 ? v : 0;
      }),
    );
    const opt: TseamOptions = {
      units: p.units,
      rollWidthFt: f.rollWidthFt,
      trimIn: f.trimIn,
      patternRepeatIn: repeat,
      pileDeg: normalizePile(f.pileDeg),
      seamOffsetFt: f.seamOffsetFt,
      roomId: lead.id,
      roomName: cluster.rooms.map((r) => r.name).join(" + "),
      roomIds: cluster.rooms.map((r) => r.id),
      netSf: round2(cluster.rooms.reduce((s, r) => s + polyNet(r, p.units), 0)),
    };
    // Respect a saved direction. Pass "auto" only when the caller asks and the
    // lead room has never had its pile turned (pileDeg 0 is also a real choice,
    // so auto is a caller decision, not inferred here).
    let layout = layoutTseam(cluster.points, opt);
    const extras = cluster.rooms.flatMap((r) => addonPieces(r, opt, layout.pieces[0]?.pile ?? { x: 1, y: 0 }, 0));
    if (extras.length) {
      layout = finish(
        [...layout.pieces, ...extras],
        layout.marks,
        layout.pileDeg,
        opt.netSf ?? layout.netSf,
        opt.rollWidthFt,
      );
    }
    for (const piece of layout.pieces) {
      piece.n = n++;
      if (piece.corners.length >= 3) {
        const c = {
          x: piece.corners.reduce((s, q) => s + q.x, 0) / piece.corners.length,
          y: piece.corners.reduce((s, q) => s + q.y, 0) / piece.corners.length,
        };
        const hit = cluster.rooms.find((r) => pointInPolygon(c, r.points));
        if (hit) {
          piece.roomId = hit.id;
          piece.roomName = hit.name;
        }
      }
    }
    for (const m of layout.marks) m.roomIds = cluster.rooms.map((r) => r.id);
    plans.push({
      title: cluster.rooms.map((r) => r.name).join(" + "),
      roomIds: cluster.rooms.map((r) => r.id),
      levelId: lead.levelId,
      points: cluster.points,
      layout,
    });
  }
  return plans;
}

export function normalizePile(deg: number): 0 | 90 {
  return Math.round((((deg % 180) + 180) % 180) / 90) % 2 === 1 ? 90 : 0;
}

/** Lowest-waste direction for one room. Used by the Auto button. */
export function autoPile(points: Pt[], opt: Omit<TseamOptions, "pileDeg">): 0 | 90 {
  return layoutTseam(points, { ...opt, pileDeg: "auto" }).pileDeg;
}

/** Sq ft this layout is billing, for tests and the quote. */
export function roomNetSf(p: FieldProperty, room: FieldRoom): number {
  return round2(toSqFt(billableArea(p, room), p.units));
}
