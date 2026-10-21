/**
 * ARCore room scan (Floorline Beta 2): pure logic, no DOM, unit-tested.
 *
 * The native ArScan plugin streams frames with the camera pose and every
 * tracked ARCore plane (world-space boundary polygon, metres, y up). This
 * module accumulates them into rooms:
 *   - one session-wide "frame angle" from the vertical planes' normals, so
 *     every wall snaps to 0°/90° and rooms stay square to each other;
 *   - per room, the camera path walked since the last "New room" tap;
 *   - each room outline = a rectangle in that frame whose sides are the
 *     nearest detected wall plane just outside the walked area, falling back
 *     to the floor plane's extent, then to the walked path plus a margin.
 * Plan space is x = world x, y = world z (both rotated into the frame).
 */
import { bbox, rectPoints, snap, type Pt } from "./model";

export type ArPlaneType = "HORIZONTAL_UPWARD_FACING" | "HORIZONTAL_DOWNWARD_FACING" | "VERTICAL";

export interface ArPlane {
  id: number;
  type: ArPlaneType;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  ex: number;
  ez: number;
  /** World-space boundary, [x, y, z] metres. */
  polygon: number[][];
}

export interface ArFrame {
  t?: number;
  tracking: "TRACKING" | "PAUSED" | "STOPPED" | string;
  failure?: string;
  depth?: boolean;
  pose: { x: number; y: number; z: number; fx: number; fy: number; fz: number };
  planes: ArPlane[];
}

export type Side = "wall" | "floor" | "path";
export interface ScanRoom {
  /** Rectangle corners in the frame, metres. */
  points: Pt[];
  /** Where the user stood when tapping "New room" (frame, metres). */
  door: Pt | null;
  /** What each side came from: [minX, maxX, minY, maxY]. */
  sides: [Side, Side, Side, Side];
}

const rot = (p: Pt, a: number): Pt => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

export const isWall = (p: ArPlane) => p.type === "VERTICAL" && Math.abs(p.ny) < 0.35;
export const isFloor = (p: ArPlane) => p.type === "HORIZONTAL_UPWARD_FACING";

/** Dominant wall axis in radians, [-45°, 45°), weighted by wall width; null without walls. */
export function wallFrameAngle(planes: ArPlane[]): number | null {
  let sx = 0;
  let sy = 0;
  for (const p of planes) {
    if (!isWall(p)) continue;
    const a = Math.atan2(p.nz, p.nx);
    const w = Math.max(p.ex, 0.1);
    sx += w * Math.cos(4 * a);
    sy += w * Math.sin(4 * a);
  }
  if (Math.hypot(sx, sy) < 1e-6) return null;
  return Math.atan2(sy, sx) / 4;
}

/** World (x, z) to frame plan point. */
export function toPlan(x: number, z: number, angle: number): Pt {
  return rot({ x, y: z }, -angle);
}

/** Floor height: the lowest sizeable upward plane (y), or null. */
export function floorHeight(planes: ArPlane[]): number | null {
  let best: number | null = null;
  for (const p of planes)
    if (isFloor(p) && p.ex * p.ez >= 0.25 && (best == null || p.cy < best)) best = p.cy;
  return best;
}

export interface OutlineOpts {
  /** How far outside the walked area a wall may be and still count, metres. */
  wallReach?: number;
  /** Margin added to the walked area when nothing else is known. */
  margin?: number;
  /** Snap step in metres (0 = none). */
  grid?: number;
}

/**
 * Rectangle for one room in the frame. `path` is the camera path (frame, metres).
 */
export function roomOutline(
  path: Pt[],
  planes: ArPlane[],
  angle: number,
  opts: OutlineOpts = {},
): ScanRoom | null {
  if (!path.length) return null;
  const reach = opts.wallReach ?? 3;
  const margin = opts.margin ?? 0.4;
  const pb = bbox(path);
  // A standing scan still gets a small area to look for walls around.
  const cx = (pb.minX + pb.maxX) / 2;
  const cy = (pb.minY + pb.maxY) / 2;
  const area = {
    minX: Math.min(pb.minX, cx - 0.3),
    maxX: Math.max(pb.maxX, cx + 0.3),
    minY: Math.min(pb.minY, cy - 0.3),
    maxY: Math.max(pb.maxY, cy + 0.3),
  };
  const tol = 0.25; // the phone is held a little inside the wall line

  // Walls, as axis lines in the frame with their along-axis span.
  type Line = { axis: "x" | "y"; v: number; lo: number; hi: number; w: number };
  const lines: Line[] = [];
  for (const p of planes) {
    if (!isWall(p) || p.polygon.length < 2) continue;
    const n = rot({ x: p.nx, y: p.nz }, -angle);
    const axis = Math.abs(n.x) >= Math.abs(n.y) ? "x" : "y";
    const pts = p.polygon.map((q) => toPlan(q[0], q[2], angle));
    const along = pts.map((q) => (axis === "x" ? q.y : q.x));
    const c = toPlan(p.cx, p.cz, angle);
    lines.push({
      axis,
      v: axis === "x" ? c.x : c.y,
      lo: Math.min(...along),
      hi: Math.max(...along),
      w: Math.max(...along) - Math.min(...along),
    });
  }
  const overlaps = (l: Line) => {
    const [lo, hi] = l.axis === "x" ? [area.minY, area.maxY] : [area.minX, area.maxX];
    return l.hi >= lo - reach * 0.5 && l.lo <= hi + reach * 0.5 && l.w >= 0.3;
  };
  const pick = (axis: "x" | "y", dir: -1 | 1): number | null => {
    const edge = axis === "x" ? (dir < 0 ? area.minX : area.maxX) : dir < 0 ? area.minY : area.maxY;
    let best: number | null = null;
    for (const l of lines) {
      if (l.axis !== axis || !overlaps(l)) continue;
      const d = (l.v - edge) * dir; // >0 outside the walked area
      if (d < -tol || d > reach) continue;
      if (best == null || (l.v - best) * dir < 0) best = l.v;
    }
    return best;
  };

  // Floor extents near this room (the floor plane may run through doorways, so clip it).
  const fy = floorHeight(planes);
  const floorPts: Pt[] = [];
  for (const p of planes) {
    if (!isFloor(p) || (fy != null && Math.abs(p.cy - fy) > 0.35)) continue;
    for (const q of p.polygon) {
      const f = toPlan(q[0], q[2], angle);
      if (
        f.x >= area.minX - reach &&
        f.x <= area.maxX + reach &&
        f.y >= area.minY - reach &&
        f.y <= area.maxY + reach
      )
        floorPts.push(f);
    }
  }
  const fb = floorPts.length >= 3 ? bbox(floorPts) : null;

  const side = (axis: "x" | "y", dir: -1 | 1): [number, Side] => {
    const w = pick(axis, dir);
    if (w != null) return [w, "wall"];
    const edge = axis === "x" ? (dir < 0 ? area.minX : area.maxX) : dir < 0 ? area.minY : area.maxY;
    if (fb) {
      const f = axis === "x" ? (dir < 0 ? fb.minX : fb.maxX) : dir < 0 ? fb.minY : fb.maxY;
      if ((f - edge) * dir > margin) return [f, "floor"];
    }
    return [edge + dir * margin, "path"];
  };
  const [x0, s0] = side("x", -1);
  const [x1, s1] = side("x", 1);
  const [y0, s2] = side("y", -1);
  const [y1, s3] = side("y", 1);
  const g = opts.grid ?? 0;
  const sn = (v: number) => (g > 0 ? snap(v, g) : v);
  const ax = sn(x0);
  const bx = Math.max(sn(x1), ax + (g || 0.1));
  const ay = sn(y0);
  const by = Math.max(sn(y1), ay + (g || 0.1));
  return { points: rectPoints(ax, ay, bx - ax, by - ay), door: null, sides: [s0, s1, s2, s3] };
}

/** Accumulates a whole multi-room scan from streamed frames. */
export class ArScanner {
  planes = new Map<number, ArPlane>();
  path: Pt[] = [];
  /** Camera path in world (x, z) for the current room; re-projected when the frame angle settles. */
  private worldPath: { x: number; z: number }[] = [];
  rooms: ScanRoom[] = [];
  angle: number | null = null;
  tracking = "STOPPED";
  failure: string | undefined;
  depth = false;
  last: ArFrame | null = null;

  push(f: ArFrame) {
    this.last = f;
    this.tracking = f.tracking;
    this.failure = f.failure;
    this.depth = !!f.depth;
    if (f.tracking !== "TRACKING") return;
    // ARCore re-sends every tracked plane each frame; drop the ones it merged away.
    this.planes = new Map(f.planes.map((p) => [p.id, p]));
    if (this.rooms.length === 0) this.angle = wallFrameAngle(f.planes) ?? this.angle;
    const prev = this.worldPath[this.worldPath.length - 1];
    if (!prev || Math.hypot(prev.x - f.pose.x, prev.z - f.pose.z) > 0.05)
      this.worldPath.push({ x: f.pose.x, z: f.pose.z });
    this.path = this.worldPath.map((p) => toPlan(p.x, p.z, this.angle ?? 0));
  }

  here(): Pt | null {
    const p = this.last?.pose;
    return p ? toPlan(p.x, p.z, this.angle ?? 0) : null;
  }

  /** Heading of the camera in the frame (radians, plan space). */
  heading(): number | null {
    const p = this.last?.pose;
    if (!p || Math.hypot(p.fx, p.fz) < 1e-3) return null;
    const d = toPlan(p.fx, p.fz, this.angle ?? 0);
    return Math.atan2(d.y, d.x);
  }

  live(grid = 0): ScanRoom | null {
    return roomOutline(this.path, [...this.planes.values()], this.angle ?? 0, { grid });
  }

  /** Close the current room at the user's position ("New room"). */
  newRoom(grid = 0): ScanRoom | null {
    const r = this.live(grid);
    if (!r) return null;
    // Lock the frame on the first room so later rooms stay square to it.
    if (this.angle == null) this.angle = 0;
    const at = this.here();
    const done = { ...r, door: at };
    this.rooms.push(done);
    // The next room starts from the next pose, so the doorway point doesn't drag it back across the wall.
    this.worldPath = [];
    this.path = [];
    return done;
  }

  undoRoom() {
    this.rooms.pop();
  }

  /** All rooms including the one in progress (if it has any area). */
  finish(grid = 0): ScanRoom[] {
    const cur = this.path.length > 1 ? this.live(grid) : null;
    return cur ? [...this.rooms, cur] : [...this.rooms];
  }

  counts() {
    let walls = 0;
    let floors = 0;
    for (const p of this.planes.values()) {
      if (isWall(p)) walls += 1;
      else if (isFloor(p)) floors += 1;
    }
    return { walls, floors };
  }
}

/** Convert metres to the property's units. */
export function scalePts(points: Pt[], k: number): Pt[] {
  return points.map((p) => ({ x: p.x * k, y: p.y * k }));
}
