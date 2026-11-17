import { roomLabelPoint, pointInPolygon, type Pt } from "./model.ts";

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
  /** The length text, so the collision box matches the drawn chip. */
  text: string;
};

function chipBox(
  text: string,
  chip: number,
  horizontal: boolean,
  sx: number,
  sy: number,
): ScreenBox {
  const halfAlong = ((text.length * 7.5 + 14) * chip) / 2;
  const halfAcross = (22 * chip) / 2;
  const halfX = horizontal ? halfAlong : halfAcross;
  const halfY = horizontal ? halfAcross : halfAlong;
  return { l: sx - halfX, t: sy - halfY, r: sx + halfX, b: sy + halfY };
}

export type Caption = {
  x: number;
  y: number;
  fontPx: number;
  lines: string[];
  box: ScreenBox;
};

function overlap(a: ScreenBox, b: ScreenBox) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

function screenOf(points: Pt[], view: { scale: number; tx: number; ty: number }): ScreenBox {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const p of points) {
    const x = view.tx + p.x * view.scale;
    const y = view.ty + p.y * view.scale;
    l = Math.min(l, x);
    r = Math.max(r, x);
    t = Math.min(t, y);
    b = Math.max(b, y);
  }
  return { l, t, r, b };
}

/** Axis-aligned screen box of a chip that has been rotated to run along its wall. */
export function labelScreenBox(label: WallLabel, view: { scale: number; tx: number; ty: number }): ScreenBox {
  const sx = view.tx + label.x * view.scale;
  const sy = view.ty + label.y * view.scale;
  return chipBox(label.text, label.scale, label.e.horizontal, sx, sy);
}

/**
 * One chip per wall, a few pixels outside the wall (or just inside when the
 * outside sits in a neighbour). Chips stay within 28 px of the wall midpoint,
 * never cover occupied text, and a shared wall of the same length is labeled once.
 */
export function layoutWallLabels(
  es: WallEdge[],
  view: { scale: number; tx: number; ty: number },
  placed: ScreenBox[],
  limits: LabelLimits,
  neighbors: Pt[][],
  obstacles: ScreenBox[],
  claimed?: { x: number; y: number; length: number; horizontal: boolean }[],
  textOf: (edge: WallEdge) => string = (edge) => `${Math.round(edge.length)}'`,
): WallLabel[] {
  const viewScale = Math.max(view.scale, 1);
  const book = claimed ?? [];
  const out: WallLabel[] = [];
  for (const e of es) {
    const L = e.length || 1;
    const nx = (e.b.y - e.a.y) / L;
    const ny = -(e.b.x - e.a.x) / L;
    const tx = -ny;
    const ty = nx;
    const midX = (e.a.x + e.b.x) / 2;
    const midY = (e.a.y + e.b.y) / 2;
    const shared = book.some(
      (c) =>
        c.horizontal === e.horizontal &&
        Math.abs(c.length - e.length) < 0.08 &&
        Math.hypot(c.x - midX, c.y - midY) < 0.4,
    );
    if (shared) continue;

    const text = textOf(e);
    const tryAt = (sign: number, distPx: number, alongPx: number, chip: number) => {
      if (Math.hypot(distPx, alongPx) > 26) return null;
      const x = midX + nx * sign * (distPx / viewScale) + tx * (alongPx / viewScale);
      const y = midY + ny * sign * (distPx / viewScale) + ty * (alongPx / viewScale);
      if (neighbors.some((poly) => pointInPolygon({ x, y }, poly))) return null;
      const sx = view.tx + x * view.scale;
      const sy = view.ty + y * view.scale;
      const box = chipBox(text, chip, e.horizontal, sx, sy);
      if (box.l < limits.left || box.r > limits.right || box.t < limits.top || box.b > limits.bottom) return null;
      if (obstacles.some((o) => overlap(box, o))) return null;
      if (placed.some((p) => overlap(box, p))) return null;
      return { e, x, y, scale: chip, leader: alongPx !== 0, text, box };
    };

    let chosen: ReturnType<typeof tryAt> = null;
    for (const chip of [1, 0.72, 0.5, 0.36]) {
      if (chosen) break;
      for (const sign of [1, -1]) {
        if (chosen) break;
        for (const dist of [10, 8, 14, 6, 18, 24]) {
          if (chosen) break;
          for (const along of [0, 8, -8, 16, -16, 22, -22]) {
            chosen = tryAt(sign, dist, along, chip);
            if (chosen) break;
          }
        }
      }
    }
    if (!chosen) continue;
    placed.push(chosen.box);
    book.push({ x: midX, y: midY, length: e.length, horizontal: e.horizontal });
    out.push({ e, x: chosen.x, y: chosen.y, scale: chosen.scale, leader: chosen.leader, text });
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

export type CaptionRoom = {
  id: string;
  points: Pt[];
  name: string;
  area: string;
  closet: boolean;
  holes: Pt[][];
};

/**
 * Name and area that fit inside the room, clear of closets and of each other.
 * A closet that is too small for even a short area line gets no text.
 */
export function layoutCaptions(
  rooms: CaptionRoom[],
  view: { scale: number; tx: number; ty: number },
): Map<string, Caption | null> {
  const order = [...rooms.filter((r) => r.closet), ...rooms.filter((r) => !r.closet)];
  const placed: ScreenBox[] = [];
  const result = new Map<string, Caption | null>();
  for (const room of order) {
    const own = screenOf(room.points, view);
    const anchor = roomLabelPoint(room.points, room.holes);
    const shortArea = room.area.replace(" sq ft", " sf");
    const options = room.closet
      ? [
          [room.name, room.area],
          [shortArea],
          [room.area.replace(/[^0-9.].*$/, "").trim() || shortArea],
        ]
      : [[room.name, room.area], [room.area]];
    let fit: Caption | null = null;
    const minFont = room.closet ? 7 : 6.5;
    for (const inset of room.closet ? [12] : [18, 12]) {
      if (fit) break;
      const inner = { l: own.l + inset, t: own.t + inset, r: own.r - inset, b: own.b - inset };
      if (inner.r - inner.l < 8 || inner.b - inner.t < 8) continue;
      for (const lines of options) {
        const usable = lines.filter((s) => s.trim().length > 0);
        if (!usable.length) continue;
        const longest = Math.max(...usable.map((s) => s.length));
        const font = Math.min(
          16,
          (inner.r - inner.l) / (longest * 0.58),
          (inner.b - inner.t) / (usable.length * 1.35),
        );
        if (font < minFont) continue;
        const w = longest * font * 0.58;
        const h = usable.length * font * 1.35;
        const sx = view.tx + anchor.x * view.scale;
        const sy = view.ty + anchor.y * view.scale;
        const box = { l: sx - w / 2, t: sy - font * 0.85, r: sx + w / 2, b: sy - font * 0.85 + h };
        if (box.l < inner.l - 0.5 || box.r > inner.r + 0.5 || box.t < inner.t - 0.5 || box.b > inner.b + 0.5) continue;
        const padded = { l: box.l - 4, t: box.t - 4, r: box.r + 4, b: box.b + 4 };
        if (placed.some((p) => overlap(padded, p))) continue;
        fit = { x: anchor.x, y: anchor.y, fontPx: font, lines: usable, box };
        break;
      }
    }
    result.set(room.id, fit);
    if (fit) placed.push(fit.box);
    else if (room.closet) {
      // Even a hidden caption reserves the closet so the parent name stays out of it.
      const pad = 4;
      placed.push({ l: own.l - pad, t: own.t - pad, r: own.r + pad, b: own.b + pad });
    }
  }
  return result;
}

/** Zoom about a screen point so that point stays put. */
export function zoomAbout(
  view: { scale: number; tx: number; ty: number },
  anchor: { x: number; y: number },
  k: number,
): { scale: number; tx: number; ty: number } {
  const scale = Math.max(4, Math.min(160, view.scale * k));
  const ratio = scale / view.scale;
  return {
    scale,
    tx: anchor.x - (anchor.x - view.tx) * ratio,
    ty: anchor.y - (anchor.y - view.ty) * ratio,
  };
}

/** Fit a room into the part of the canvas that is clear of chrome, including label padding. */
export function frameInFreeArea(
  bounds: { minX: number; minY: number; w: number; h: number },
  canvas: { w: number; h: number },
  free: { top: number; right: number; bottom: number; left: number },
): { scale: number; tx: number; ty: number } {
  const availW = Math.max(40, canvas.w - free.left - free.right);
  const availH = Math.max(40, canvas.h - free.top - free.bottom);
  const scale = Math.max(4, Math.min(120, Math.min(availW / Math.max(bounds.w, 1), availH / Math.max(bounds.h, 1))));
  return {
    scale,
    tx: free.left + (availW - bounds.w * scale) / 2 - bounds.minX * scale,
    ty: free.top + (availH - bounds.h * scale) / 2 - bounds.minY * scale,
  };
}

export function roomScreenBox(
  bounds: { minX: number; minY: number; w: number; h: number },
  view: { scale: number; tx: number; ty: number },
): ScreenBox {
  return screenOf(
    [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.minX + bounds.w, y: bounds.minY + bounds.h },
    ],
    view,
  );
}
