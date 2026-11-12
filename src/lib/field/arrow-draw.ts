/**
 * Arrow drawing: each laser or typed length extends the outline in a chosen
 * direction. Plan +y is down, so 0° is up the page and degrees run clockwise.
 * Pure and undoable — the UI keeps a history of Draft values.
 */

import { commit, initHistory, redo, undo, type History } from "./history.ts";
import {
  area,
  bbox,
  closureGap,
  edges,
  ensureClockwise,
  formatLength,
  isSimple,
  newRoom,
  round2,
  translate,
  type FieldOpening,
  type FieldRoom,
  type Pt,
  type Units,
} from "./model.ts";
import { metersToPlan } from "./disto-protocol.ts";

export type HeadingId =
  | "up"
  | "up-right"
  | "right"
  | "down-right"
  | "down"
  | "down-left"
  | "left"
  | "up-left";

export const HEADINGS: { id: HeadingId; deg: number; label: string; arrow: string }[] = [
  { id: "up-left", deg: 315, label: "Up-left", arrow: "↖" },
  { id: "up", deg: 0, label: "Up", arrow: "↑" },
  { id: "up-right", deg: 45, label: "Up-right", arrow: "↗" },
  { id: "left", deg: 270, label: "Left", arrow: "←" },
  { id: "right", deg: 90, label: "Right", arrow: "→" },
  { id: "down-left", deg: 225, label: "Down-left", arrow: "↙" },
  { id: "down", deg: 180, label: "Down", arrow: "↓" },
  { id: "down-right", deg: 135, label: "Down-right", arrow: "↘" },
];

/** Clockwise degrees from plan-up, wrapped into [0, 360). */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Unit step in plan space. 0° is up (−y). */
export function directionVector(deg: number): Pt {
  const r = (normalizeDeg(deg) * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

export function closeThreshold(units: Units): number {
  return units === "ft" ? 0.5 : 0.15;
}

export type DraftOpening = {
  id: string;
  kind: "door" | "opening" | "cased";
  wall: number;
  /** Distance from the wall's start corner to the opening's centre. */
  offset: number;
  width: number;
  transition: "auto" | "none" | "t-mold";
};

export type DraftCloset = {
  id: string;
  name: string;
  points: Pt[];
  includeInParent: boolean;
  wall: number;
};

export type Draft = {
  points: Pt[];
  headingDeg: number;
  openings: DraftOpening[];
  closets: DraftCloset[];
  /** Arrow-drawing a closet off `closetWall`, or null while drawing the room. */
  closetChain: Pt[] | null;
  closetWall: number;
  closetName: string;
  closetInclude: boolean;
  /** Set once the room chain has been closed. Further room shots are rejected. */
  roomClosed: boolean;
  /** Miss distance (auto-close) or gap to the start (close button). Null until closed. */
  closingError: number | null;
};

export function blankDraft(headingDeg = 0): Draft {
  return {
    points: [{ x: 0, y: 0 }],
    headingDeg: normalizeDeg(headingDeg),
    openings: [],
    closets: [],
    closetChain: null,
    closetWall: 0,
    closetName: "closet",
    closetInclude: true,
    roomClosed: false,
    closingError: null,
  };
}

export function gapToStart(points: Pt[]): number {
  if (points.length < 2) return Infinity;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function currentWall(points: Pt[]): { index: number; a: Pt; b: Pt; length: number } | null {
  if (points.length < 2) return null;
  const index = points.length - 2;
  const a = points[index];
  const b = points[index + 1];
  return { index, a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
}

function addPoint(points: Pt[], deg: number, length: number): Pt[] {
  const a = points[points.length - 1];
  const v = directionVector(deg);
  return [...points, { x: round2(a.x + v.x * length), y: round2(a.y + v.y * length) }];
}

export type ShotResult =
  | { ok: true; draft: Draft; event: "segment" }
  | { ok: true; draft: Draft; event: "closed"; closingError: number; closets?: DraftCloset }
  | { ok: false; reason: string };

/**
 * Add a segment in the draft's heading. When the new end lands within
 * {@link closeThreshold} of the chain start (and the chain can already be a
 * room), the shot closes the shape instead of adding a point. `closingError`
 * is how far that shot missed the start.
 */
export function shoot(draft: Draft, length: number, units: Units): ShotResult {
  if (!(length > 0) || !Number.isFinite(length)) return { ok: false, reason: "Length has to be greater than zero." };
  if (!draft.closetChain && draft.roomClosed) return { ok: false, reason: "Room is already closed." };
  const chain = draft.closetChain ?? draft.points;
  const next = addPoint(chain, draft.headingDeg, length);
  const canClose = chain.length >= 3;
  if (canClose) {
    const end = next[next.length - 1];
    const error = Math.hypot(end.x - chain[0].x, end.y - chain[0].y);
    if (error <= closeThreshold(units)) {
      return finishChain(draft, chain, error);
    }
  }
  if (draft.closetChain) return { ok: true, draft: { ...draft, closetChain: next }, event: "segment" };
  return { ok: true, draft: { ...draft, points: next }, event: "segment" };
}

export function shootMeters(draft: Draft, meters: number, units: Units): ShotResult {
  return shoot(draft, metersToPlan(meters, units), units);
}

function finishChain(draft: Draft, chain: Pt[], error: number): ShotResult {
  if (chain.length < 3) return { ok: false, reason: "Need at least three corners to close." };
  if (draft.closetChain) {
    const closet: DraftCloset = {
      id: "",
      name: draft.closetName.trim() || "closet",
      points: chain,
      includeInParent: draft.closetInclude,
      wall: draft.closetWall,
    };
    return {
      ok: true,
      event: "closed",
      closingError: error,
      closets: closet,
      draft: { ...draft, closets: [...draft.closets, closet], closetChain: null },
    };
  }
  return {
    ok: true,
    draft: { ...draft, points: chain, roomClosed: true, closingError: error },
    event: "closed",
    closingError: error,
  };
}

/** Close the open chain with a button. The error is the square-close miss, not the straight line back to the start. */
export function closeDraft(draft: Draft): ShotResult {
  const chain = draft.closetChain ?? draft.points;
  if (chain.length < 3) return { ok: false, reason: "Need at least three corners before closing." };
  return finishChain(draft, chain, closureGap(chain));
}

export type OpeningInput = {
  kind: DraftOpening["kind"];
  width: number;
  offset: number;
  transition: DraftOpening["transition"];
  id?: string;
};

/** Place a door, doorway, or cased opening on the current (last) wall. */
export function addOpening(draft: Draft, input: OpeningInput): { ok: true; draft: Draft } | { ok: false; reason: string } {
  if (draft.closetChain) return { ok: false, reason: "Finish the closet before adding an opening on the room." };
  const wall = currentWall(draft.points);
  if (!wall) return { ok: false, reason: "Shoot a wall first, then put the opening on it." };
  if (!(input.width > 0)) return { ok: false, reason: "Opening width has to be greater than zero." };
  if (input.width > wall.length + 1e-6) return { ok: false, reason: "That opening is wider than the wall." };
  const half = input.width / 2;
  if (!(input.offset >= half - 1e-6 && input.offset <= wall.length - half + 1e-6)) {
    return { ok: false, reason: "Move the opening so it sits fully on the wall." };
  }
  const opening: DraftOpening = {
    id: input.id ?? "",
    kind: input.kind,
    wall: wall.index,
    offset: round2(input.offset),
    width: round2(input.width),
    transition: input.transition,
  };
  return { ok: true, draft: { ...draft, openings: [...draft.openings, opening] } };
}

/** Rectangle closet off the current wall. `outward` sticks it outside a clockwise room. */
export function closetRectangle(
  draft: Draft,
  width: number,
  depth: number,
  outward: boolean,
  id = "",
): { ok: true; draft: Draft; closet: DraftCloset } | { ok: false; reason: string } {
  if (draft.closetChain) return { ok: false, reason: "Finish the closet you're drawing first." };
  const wall = currentWall(draft.points);
  if (!wall) return { ok: false, reason: "Shoot a wall first, then add the closet on it." };
  if (!(width > 0) || !(depth > 0)) return { ok: false, reason: "Width and depth have to be greater than zero." };
  const points = closetRectPoints(wall.a, wall.b, width, depth, outward);
  const closet: DraftCloset = {
    id,
    name: draft.closetName.trim() || "closet",
    points,
    includeInParent: draft.closetInclude,
    wall: wall.index,
  };
  return { ok: true, draft: { ...draft, closets: [...draft.closets, closet] }, closet };
}

export function closetRectPoints(a: Pt, b: Pt, width: number, depth: number, outward: boolean): Pt[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  // Inward for a clockwise y-down outline is (−uy, ux). Outward is the opposite.
  const sign = outward ? -1 : 1;
  const nx = sign * -uy;
  const ny = sign * ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const half = width / 2;
  const c0 = { x: round2(mid.x - ux * half), y: round2(mid.y - uy * half) };
  const c1 = { x: round2(mid.x + ux * half), y: round2(mid.y + uy * half) };
  const c2 = { x: round2(c1.x + nx * depth), y: round2(c1.y + ny * depth) };
  const c3 = { x: round2(c0.x + nx * depth), y: round2(c0.y + ny * depth) };
  return [c0, c1, c2, c3];
}

export function startClosetChain(draft: Draft): { ok: true; draft: Draft } | { ok: false; reason: string } {
  const wall = currentWall(draft.points);
  if (!wall) return { ok: false, reason: "Shoot a wall first, then draw the closet off it." };
  if (draft.closetChain) return { ok: false, reason: "Already drawing a closet." };
  return {
    ok: true,
    draft: { ...draft, closetChain: [wall.b], closetWall: wall.index },
  };
}

export function rectangleDims(points: Pt[]): { w: number; h: number } | null {
  if (points.length !== 4) return null;
  const lens = edges(points).map((e) => e.length);
  const d0 = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  const d1 = { x: points[2].x - points[1].x, y: points[2].y - points[1].y };
  const dot = d0.x * d1.x + d0.y * d1.y;
  if (Math.abs(dot) > 0.02 * (lens[0] * lens[1] || 1)) return null;
  if (Math.abs(lens[0] - lens[2]) > 0.05 || Math.abs(lens[1] - lens[3]) > 0.05) return null;
  return { w: round2(lens[0]), h: round2(lens[1]) };
}

/** "MBR closet 6'-7" × 7'-4" = 48.28 sf" */
export function closetCaption(parentName: string, closetName: string, points: Pt[], units: Units): string {
  const dims = rectangleDims(points);
  const size = dims
    ? `${formatLength(dims.w, units)} × ${formatLength(dims.h, units)}`
    : `${formatLength(Math.round(edges(points).reduce((s, e) => s + e.length, 0) * 100) / 100, units)} around`;
  const sq = area(points);
  const areaText =
    units === "ft" ? `${sq.toFixed(2)} sf` : `${sq.toFixed(2)} m²`;
  return `${parentName} ${closetName} ${size} = ${areaText}`;
}

/** Plan label. `roomName` may already start with the parent name ("MBR closet"). */
export function closetPlanLabel(parentName: string, roomName: string, points: Pt[], units: Units): string {
  const prefix = `${parentName} `;
  const short = roomName.startsWith(prefix) ? roomName.slice(prefix.length) : roomName;
  return closetCaption(parentName, short, points, units);
}

export type CommitIds = (prefix: string) => string;

export type CommittedOutline = {
  room: FieldRoom;
  openings: FieldOpening[];
  closets: FieldRoom[];
  closingError: number;
};

/**
 * Turn a closed draft into a room, its openings, and attached closet rooms.
 * `closingError` is the gap that was snapped (0 when the last corner already
 * met the start). Points are shifted so the outline sits at `origin`.
 */
export function commitDraft(
  draft: Draft,
  opts: { name: string; levelId: string; units: Units; origin: Pt; ids: CommitIds },
): { ok: true; committed: CommittedOutline } | { ok: false; reason: string } {
  if (draft.closetChain) return { ok: false, reason: "Close the closet before adding the room." };
  if (draft.points.length < 3) return { ok: false, reason: "The room needs at least three corners." };
  const closingError = draft.closingError ?? gapToStart(draft.points);
  if (!isSimple(draft.points) || area(draft.points) < 1e-4) {
    return { ok: false, reason: "That outline crosses itself or has no area." };
  }
  const oriented = orientOpenings(draft.points, draft.openings);
  const all = [...oriented.points, ...draft.closets.flatMap((c) => c.points)];
  const box = bbox(all);
  const dx = opts.origin.x - box.minX;
  const dy = opts.origin.y - box.minY;
  const roomPoints = translate(oriented.points, dx, dy);
  const room = newRoom(opts.name, roomPoints, "typed", opts.levelId);
  room.id = opts.ids("room");
  const openings: FieldOpening[] = oriented.openings.map((o) => ({
    id: opts.ids("opening"),
    roomId: room.id,
    kind: o.kind === "door" ? "door" : "opening",
    wall: o.wall,
    offset: o.offset,
    width: o.width,
    ...(o.transition === "auto" ? {} : { transition: o.transition }),
    ...(o.kind === "cased" ? { cased: true } : {}),
  }));
  const closets: FieldRoom[] = draft.closets.map((c) => {
    const pts = translate(ensureClockwise(c.points), dx, dy);
    const closet = newRoom(`${opts.name} ${c.name}`.trim(), pts, "typed", opts.levelId);
    closet.id = opts.ids("room");
    closet.closet = { parentId: room.id, includeInParent: c.includeInParent };
    if (c.includeInParent) closet.flooring = { material: "none" };
    return closet;
  });
  return { ok: true, committed: { room, openings, closets, closingError } };
}

function wallLength(points: Pt[], index: number): number {
  const a = points[index];
  const b = points[(index + 1) % points.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Flip a counter-clockwise ring and remap opening walls so they stay on the same edge. */
export function orientOpenings(points: Pt[], openings: DraftOpening[]): { points: Pt[]; openings: DraftOpening[] } {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  if (sum >= 0) return { points, openings };
  const n = points.length;
  const rev = [...points].reverse();
  return {
    points: rev,
    openings: openings.map((o) => ({
      ...o,
      wall: (n - 2 - o.wall + n) % n,
      offset: round2(wallLength(points, o.wall) - o.offset),
    })),
  };
}

export function draftHistory(headingDeg = 0): History<Draft> {
  return initHistory(blankDraft(headingDeg));
}

export function pushDraft(h: History<Draft>, next: Draft): History<Draft> {
  return commit(h, next);
}

export function undoDraft(h: History<Draft>): History<Draft> {
  return undo(h);
}

export function redoDraft(h: History<Draft>): History<Draft> {
  return redo(h);
}

/** Where the next laser shot would land, for the on-plan preview arrow. */
export function previewEnd(draft: Draft, length: number): Pt | null {
  if (!(length > 0)) return null;
  const chain = draft.closetChain ?? draft.points;
  const a = chain[chain.length - 1];
  const v = directionVector(draft.headingDeg);
  return { x: a.x + v.x * length, y: a.y + v.y * length };
}

/** Next wall after a laser shot: the next edge, then the next room's first wall. */
export function advanceLaserTarget(
  rooms: { id: string; wallCount: number }[],
  roomId: string,
  wall: number,
): { roomId: string; wall: number } | null {
  const i = rooms.findIndex((r) => r.id === roomId);
  if (i < 0) return null;
  if (wall + 1 < rooms[i].wallCount) return { roomId, wall: wall + 1 };
  const next = rooms[i + 1];
  if (next && next.wallCount > 0) return { roomId: next.id, wall: 0 };
  return null;
}
