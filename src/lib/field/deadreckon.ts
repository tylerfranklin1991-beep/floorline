/**
 * Pedestrian dead reckoning for continuous walk mode.
 * Pure logic (no DOM) so it can be unit-tested: step detection from
 * accelerometer magnitude, heading smoothing, path integration, and turning
 * a traced perimeter into a rough rectilinear room polygon.
 */
import { bbox, nearestWall, rectilinearize, type Pt } from "./model";

export const DEFAULT_STRIDE_M = 0.7;
export const FT_PER_M = 1 / 0.3048;

/**
 * Detects steps from |acceleration including gravity| samples (m/s²).
 * Removes gravity with a slow low-pass, smooths with a fast one, then counts
 * a step on each peak above `threshold` with hysteresis and a minimum gap.
 */
export class StepDetector {
  private gravity = 9.81;
  private smooth = 0;
  private armed = true;
  private lastStep = -Infinity;
  constructor(
    private threshold = 1.1,
    private minGapMs = 280,
  ) {}
  /** Feed one sample; returns true when a step is detected. */
  push(magnitude: number, tMs: number): boolean {
    if (!Number.isFinite(magnitude)) return false;
    this.gravity += (magnitude - this.gravity) * 0.02;
    const lin = magnitude - this.gravity;
    this.smooth += (lin - this.smooth) * 0.35;
    if (this.armed && this.smooth > this.threshold && tMs - this.lastStep >= this.minGapMs) {
      this.armed = false;
      this.lastStep = tMs;
      return true;
    }
    if (!this.armed && this.smooth < this.threshold * 0.3) this.armed = true;
    return false;
  }
}

/** Compass heading in degrees clockwise from north, from a DeviceOrientation-like event. */
export function compassHeading(e: {
  alpha: number | null;
  webkitCompassHeading?: number;
}): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading))
    return e.webkitCompassHeading;
  if (e.alpha == null || !Number.isFinite(e.alpha)) return null;
  return (360 - e.alpha) % 360;
}

/** Circular exponential smoothing of headings (degrees). */
export class HeadingFilter {
  private x = 0;
  private y = 0;
  private has = false;
  constructor(private k = 0.25) {}
  push(deg: number): number {
    const r = (deg * Math.PI) / 180;
    if (!this.has) {
      this.x = Math.cos(r);
      this.y = Math.sin(r);
      this.has = true;
    } else {
      this.x += (Math.cos(r) - this.x) * this.k;
      this.y += (Math.sin(r) - this.y) * this.k;
    }
    return this.value()!;
  }
  value(): number | null {
    if (!this.has) return null;
    return ((Math.atan2(this.y, this.x) * 180) / Math.PI + 360) % 360;
  }
}

/**
 * Advance a position by one stride. `relHeadingDeg` is the heading relative to
 * the start heading (clockwise). Plan space is y-down, so the start direction
 * is +x and a right turn is clockwise — same convention as the camera walk.
 */
export function advance(p: Pt, relHeadingDeg: number, stride: number): Pt {
  const r = (relHeadingDeg * Math.PI) / 180;
  return { x: p.x + stride * Math.cos(r), y: p.y + stride * Math.sin(r) };
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
}

/** Douglas–Peucker polyline simplification. */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points.slice();
  let idx = -1;
  let max = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDist(points[i], a, b);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tolerance) return [a, b];
  const left = simplify(points.slice(0, idx + 1), tolerance);
  const right = simplify(points.slice(idx), tolerance);
  return [...left.slice(0, -1), ...right];
}

function rotate(p: Pt, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Turn a walked perimeter (in plan coordinates) into a rough rectilinear room
 * polygon that stays where it was walked. `frameAngle` (radians) rotates the
 * path so walls line up with the axes; the same angle is used for every room
 * in a session so rooms stay square to each other.
 * Returns null when the trace is too short to be a room.
 */
export function roomFromTrace(
  trace: Pt[],
  opts: { tolerance: number; grid: number; frameAngle: number; minSize: number },
): Pt[] | null {
  if (trace.length < 3) return null;
  const rot = trace.map((p) => rotate(p, -opts.frameAngle));
  const box = bbox(rot);
  if (box.w < opts.minSize && box.h < opts.minSize) return null;
  const closed = [...rot, rot[0]];
  let simple = simplify(closed, opts.tolerance);
  simple = simple.slice(0, -1);
  if (simple.length < 3) simple = rot;
  const shape = rectilinearize(simple, opts.grid);
  const sb = bbox(shape);
  // rectilinearize moves the shape to the origin; put it back where it was walked.
  const dx = box.minX - sb.minX;
  const dy = box.minY - sb.minY;
  const placed = shape.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return placed;
}

/** Rotate plan points into the room frame used by roomFromTrace. */
export function toFrame(p: Pt, frameAngle: number): Pt {
  return rotate(p, -frameAngle);
}

/** Where a doorway at point `p` sits on a room outline. */
export function doorwayOn(points: Pt[], p: Pt) {
  return nearestWall(points, p);
}

/** Stride from a calibration walk; null if the numbers make no sense. */
export function strideFromCalibration(distance: number, steps: number): number | null {
  if (!(distance > 0) || !(steps >= 3)) return null;
  const s = distance / steps;
  return s > 0.05 && s < 3 ? s : null;
}

/** Axis of a walked trace (radians, [-45°, 45°)): used once per session to square the rooms. */
export function dominantFrameAngle(trace: Pt[]): number {
  let sx = 0;
  let sy = 0;
  for (let i = 1; i < trace.length; i += 1) {
    const dx = trace[i].x - trace[i - 1].x;
    const dy = trace[i].y - trace[i - 1].y;
    const L = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    sx += L * Math.cos(4 * a);
    sy += L * Math.sin(4 * a);
  }
  return sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx) / 4;
}
