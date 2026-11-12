import { useBlobUrl } from "@/lib/field/use-blob-url";
import { listedArea, roomFlooring } from "@/lib/field/materials";
import { carpetPlans } from "@/lib/field/tseam";
import { closetPlanLabel } from "@/lib/field/arrow-draw";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  area,
  bbox,
  centroid,
  defaultOpeningWidth,
  edges,
  formatArea,
  formatLength,
  gridStep,
  isRectilinear,
  magnetOffset,
  moveCorner,
  moveWall,
  nearestWall,
  newRoom,
  newStairs,
  openingSegment,
  stairsArrow,
  stairsLabel,
  stairsRect,
  stairsTreads,
  closureGap,
  snapWallLength,
  wallSnapInches,
  pointInPolygon,
  rectPoints,
  setWallLength,
  snap,
  translate,
  uid,
  type FieldProperty,
  type Pt,
} from "@/lib/field/model";
import { useField } from "@/lib/field/store";

export type EditorMode =
  | "select"
  | "draw"
  | "door"
  | "window"
  | "opening"
  | "stairs"
  /** Drag moves the trace background. */
  | "trace"
  /** Tap two points to calibrate the trace scale. */
  | "calibrate";

type View = { scale: number; tx: number; ty: number };

type Drag =
  | { kind: "pan"; start: Pt; view: View }
  | { kind: "room"; roomId: string; start: Pt; points: Pt[]; moved: boolean }
  | { kind: "corner"; roomId: string; index: number; points: Pt[] }
  | { kind: "wall"; roomId: string; index: number; start: Pt; points: Pt[] }
  | { kind: "draw"; start: Pt; end: Pt }
  | { kind: "stairs"; id: string; start: Pt; x: number; y: number }
  | { kind: "pinch"; d0: number; mid0: Pt; view: View }
  | { kind: "trace"; start: Pt; x: number; y: number }
  | { kind: "seam"; roomIds: string[]; start: Pt; offsetFt: number; pile: 0 | 90 }
  | { kind: "label"; roomId: string; index: number; points: Pt[]; moved: boolean; base: number; ax: number; ay: number };

const HANDLE_PX = 22;
/** A press that moves farther than this is a drag, not a tap that opens the room menu. */
const TAP_SLOP_PX = 10;

type ScreenBox = { l: number; t: number; r: number; b: number };

/** Wall-length chips sit outside the room and step further out if they would cover each other. */
function layoutWallLabels(
  es: { a: Pt; b: Pt; index: number; length: number; horizontal: boolean }[],
  view: { scale: number; tx: number; ty: number },
  placed: ScreenBox[],
) {
  return es.map((e) => {
    const L = e.length || 1;
    const nx = (e.b.y - e.a.y) / L;
    const ny = -(e.b.x - e.a.x) / L;
    let dist = 26;
    let x = (e.a.x + e.b.x) / 2;
    let y = (e.a.y + e.b.y) / 2;
    for (let step = 0; step < 8; step++) {
      x = (e.a.x + e.b.x) / 2 + nx * (dist / Math.max(view.scale, 1));
      y = (e.a.y + e.b.y) / 2 + ny * (dist / Math.max(view.scale, 1));
      let sy = view.ty + y * view.scale;
      if (sy < 56) {
        y += (56 - sy) / Math.max(view.scale, 1);
        sy = 56;
      }
      const sx = view.tx + x * view.scale;
      const box = { l: sx - 34, t: sy - 14, r: sx + 34, b: sy + 14 };
      const hit = placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
      if (!hit || step === 7) {
        placed.push(box);
        break;
      }
      dist += 22;
    }
    return { e, x, y };
  });
}

function labelRotation(e: { a: Pt; b: Pt; horizontal: boolean }): number {
  const axis = Math.abs(e.a.x - e.b.x) < 1e-3 || Math.abs(e.a.y - e.b.y) < 1e-3;
  if (axis) return e.horizontal ? 0 : -90;
  let deg = (Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

export function PlanEditor({
  property,
  mode,
  onModeDone,
  onWallTap,
  onPhotoTap,
  onOpeningTap,
  onCalibrate,
  onRoomTap,
  onOpenMenu,
  onSuppressMenu,
  fitNonce,
  drawName,
  focusWall,
  draft,
  draftOrigin,
  seamEdit,
}: {
  property: FieldProperty;
  mode: EditorMode;
  onModeDone: () => void;
  onWallTap: (roomId: string, wall: number) => void;
  onPhotoTap: (roomId: string, photoId: string) => void;
  /** Tap on a door / window / doorway. */
  onOpeningTap?: (roomId: string, openingId: string) => void;
  /** Two calibration points picked (plan units). */
  onCalibrate?: (a: Pt, b: Pt) => void;
  /** Tap the room interior (not a wall). Null when the press missed every room. */
  onRoomTap?: (roomId: string | null) => void;
  /** A tap with no drag — open the room menu. */
  onOpenMenu?: () => void;
  /** A drag passed the tap slop — keep the room menu closed. */
  onSuppressMenu?: () => void;
  fitNonce: number;
  drawName?: string | null;
  /** Wall the laser will fill. */
  focusWall?: number | null;
  /** In-progress arrow drawing, in local coordinates. */
  draft?: {
    points: Pt[];
    closets: Pt[][];
    openings: { a: Pt; b: Pt }[];
    openCloset: Pt[] | null;
    preview: Pt | null;
  } | null;
  draftOrigin?: Pt;
  /** Seam lines can be dragged, and the T-seam diagram is drawn on top. */
  seamEdit?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [view, setView] = useState<View>({ scale: 24, tx: 40, ty: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const press = useRef({ x: 0, y: 0, menu: false });
  const labelWait = useRef<number | null>(null);
  const labelPending = useRef<{ roomId: string; index: number; points: Pt[] } | null>(null);
  const measured = useRef(false);
  const fitKey = useRef("");
  const selectedRoomId = useField((s) => s.selectedRoomId);
  const select = useField((s) => s.select);
  const selectedOpeningId = useField((s) => s.selectedOpeningId);
  const preview = useField((s) => s.preview);
  const beginDrag = useField((s) => s.beginDrag);
  const commitDrag = useField((s) => s.commitDrag);
  const addRoom = useField((s) => s.addRoom);
  const addOpening = useField((s) => s.addOpening);
  const selectedStairsId = useField((s) => s.selectedStairsId);
  const selectStairs = useField((s) => s.selectStairs);
  const addStairs = useField((s) => s.addStairs);
  const currentLevelId = useField((s) => s.currentLevelId);
  const change = useField((s) => s.change);
  const traceLevelId = currentLevelId ?? property.levels[0]?.id;
  const trace = property.levels.find((l) => l.id === traceLevelId)?.trace;
  const traceUrl = useBlobUrl(trace?.imageId);
  const [calPts, setCalPts] = useState<Pt[]>([]);
  useEffect(() => {
    if (mode !== "calibrate") setCalPts([]);
  }, [mode]);
  const setTracePos = (x: number, y: number, commit: boolean) => {
    const fn = (prop: FieldProperty) => ({
      ...prop,
      levels: prop.levels.map((l) =>
        l.id === traceLevelId && l.trace ? { ...l, trace: { ...l.trace, x, y } } : l,
      ),
    });
    if (commit) change(fn);
    else preview(fn);
  };
  const step = gridStep(property.units);
  const unitPx = property.units === "ft" ? 1 : 3.2808;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const apply = () => {
      measured.current = true;
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts = [
      ...property.rooms.flatMap((r) => r.points),
      ...property.stairs.flatMap((st) => {
        const r = stairsRect(st);
        return [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
        ];
      }),
    ];
    const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 20 / unitPx, h: 16 / unitPx };
    const pad = 56;
    const scale = Math.max(
      4,
      Math.min(
        120,
        Math.min((size.w - pad * 2) / Math.max(b.w, 1), (size.h - pad * 2) / Math.max(b.h, 1)),
      ),
    );
    setView({
      scale,
      tx: (size.w - b.w * scale) / 2 - b.minX * scale,
      ty: (size.h - b.h * scale) / 2 - b.minY * scale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, property.id, property.rooms.length === 0, unitPx]);

  // Fit when the job changes or the user asks. A keyboard or menu must not
  // zoom the plan just because the canvas element changed size.
  useEffect(() => {
    if (!measured.current || size.w < 40 || size.h < 40) return;
    const key = `${property.id}|${fitNonce}|${property.rooms.length === 0}|${unitPx}`;
    if (fitKey.current === key) return;
    fitKey.current = key;
    fit();
  }, [size.w, size.h, fit, fitNonce, property.id, property.rooms.length, unitPx]);

  const toPlan = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = wrap.current!.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - view.tx) / view.scale,
        y: (e.clientY - r.top - view.ty) / view.scale,
      };
    },
    [view],
  );

  const roomAt = (p: Pt) => [...property.rooms].reverse().find((r) => pointInPolygon(p, r.points));

  const noteSlop = (e: { clientX: number; clientY: number }) => {
    const d = Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y);
    if (d > TAP_SLOP_PX && !press.current.menu) {
      press.current.menu = true;
      onSuppressMenu?.();
    }
    return d > TAP_SLOP_PX;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press.current = { x: e.clientX, y: e.clientY, menu: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (drag && drag.kind !== "pan" && drag.kind !== "pinch") commitDrag();
      setDrag({
        kind: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view,
      });
      return;
    }
    const p = toPlan(e);
    const target = (e.target as Element).closest("[data-h]") as HTMLElement | null;
    const h = target?.dataset.h;
    const room = target?.dataset.room
      ? property.rooms.find((r) => r.id === target.dataset.room)
      : undefined;

    if (mode === "calibrate") {
      const next = [...calPts, p];
      if (next.length >= 2) {
        setCalPts([]);
        onCalibrate?.(next[0], next[1]);
      } else setCalPts(next);
      return;
    }
    if (mode === "trace" && trace && !trace.locked) {
      beginDrag();
      setDrag({ kind: "trace", start: p, x: trace.x, y: trace.y });
      return;
    }
    if (mode === "draw") {
      const s = { x: snap(p.x, step), y: snap(p.y, step) };
      setDrag({ kind: "draw", start: s, end: s });
      return;
    }
    if (mode === "stairs") {
      addStairs(
        newStairs(
          currentLevelId ?? property.levels[0].id,
          { x: snap(p.x, step), y: snap(p.y, step) },
          property.units,
        ),
      );
      onModeDone();
      return;
    }
    if (mode === "door" || mode === "window" || mode === "opening") {
      const candidates = selectedRoomId
        ? property.rooms
            .filter((r) => r.id === selectedRoomId)
            .concat(property.rooms.filter((r) => r.id !== selectedRoomId))
        : property.rooms;
      let best: { roomId: string; wall: number; offset: number; distance: number } | null = null;
      for (const r of candidates) {
        const n = nearestWall(r.points, p);
        if (!best || n.distance < best.distance - 1e-6) best = { roomId: r.id, ...n };
      }
      if (best && best.distance * view.scale < 48) {
        const oid = uid("open");
        addOpening({
          id: oid,
          roomId: best.roomId,
          kind: mode,
          wall: best.wall,
          offset: snap(best.offset, step),
          width: defaultOpeningWidth(mode, property.units),
        });
        select(best.roomId, oid);
        onModeDone();
      }
      return;
    }
    if (h === "corner" && room) {
      beginDrag();
      setDrag({
        kind: "corner",
        roomId: room.id,
        index: Number(target!.dataset.i),
        points: room.points,
      });
      return;
    }
    if (h === "wall" && room) {
      beginDrag();
      setDrag({
        kind: "wall",
        roomId: room.id,
        index: Number(target!.dataset.i),
        start: p,
        points: room.points,
      });
      return;
    }
    if (h === "label" && room && mode === "select") {
      const index = Number(target!.dataset.i);
      labelPending.current = { roomId: room.id, index, points: room.points };
      if (labelWait.current) window.clearTimeout(labelWait.current);
      labelWait.current = window.setTimeout(() => {
        const pending = labelPending.current;
        labelWait.current = null;
        if (!pending) return;
        const src = pending.points;
        const a = src[pending.index];
        const b = src[(pending.index + 1) % src.length];
        beginDrag();
        setDrag({
          kind: "label",
          roomId: pending.roomId,
          index: pending.index,
          points: src,
          moved: false,
          base: Math.hypot(b.x - a.x, b.y - a.y),
          ax: press.current.x,
          ay: press.current.y,
        });
        labelPending.current = null;
      }, 350);
      return;
    }
    if (h === "opening" && room) {
      select(room.id, target!.dataset.opening!);
      onOpeningTap?.(room.id, target!.dataset.opening!);
      return;
    }
    if (h === "photo" && room) {
      onPhotoTap(room.id, target!.dataset.photo!);
      return;
    }
    if (h === "seam" && seamEdit) {
      const ids = (target!.dataset.rooms ?? "").split(",").filter(Boolean);
      const lead = property.rooms.find((r) => r.id === ids[0]);
      beginDrag();
      setDrag({
        kind: "seam",
        roomIds: ids,
        start: p,
        offsetFt: lead ? roomFlooring(lead, property.job).seamOffsetFt : 0,
        pile: target!.dataset.pile === "90" ? 90 : 0,
      });
      return;
    }
    const st = [...property.stairs].reverse().find((x) => {
      const r = stairsRect(x);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (st) {
      beginDrag();
      setDrag({ kind: "stairs", id: st.id, start: p, x: st.x, y: st.y });
      return;
    }
    const hit = roomAt(p);
    if (hit) {
      beginDrag();
      setDrag({ kind: "room", roomId: hit.id, start: p, points: hit.points, moved: false });
      return;
    }
    select(null);
    onRoomTap?.(null);
    selectStairs(null);
    setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, view });
  };

  const setRoomPoints = (roomId: string, points: Pt[]) =>
    preview((prop) => ({
      ...prop,
      rooms: prop.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)),
    }));

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag && labelPending.current) {
      const d = Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y);
      if (d > TAP_SLOP_PX) {
        if (labelWait.current) window.clearTimeout(labelWait.current);
        labelWait.current = null;
        labelPending.current = null;
        setDrag({ kind: "pan", start: { x: press.current.x, y: press.current.y }, view });
      }
      return;
    }
    if (!drag) return;
    if (drag.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = wrap.current!.getBoundingClientRect();
      const k = d / Math.max(drag.d0, 1);
      const scale = Math.max(4, Math.min(160, drag.view.scale * k));
      const ratio = scale / drag.view.scale;
      const m0 = { x: drag.mid0.x - r.left, y: drag.mid0.y - r.top };
      setView({
        scale,
        tx: m0.x - (m0.x - drag.view.tx) * ratio + (mid.x - drag.mid0.x),
        ty: m0.y - (m0.y - drag.view.ty) * ratio + (mid.y - drag.mid0.y),
      });
      return;
    }
    if (drag.kind === "pan") {
      setView({
        ...drag.view,
        tx: drag.view.tx + e.clientX - drag.start.x,
        ty: drag.view.ty + e.clientY - drag.start.y,
      });
      return;
    }
    const p = toPlan(e);
    if (drag.kind === "trace") {
      setTracePos(drag.x + p.x - drag.start.x, drag.y + p.y - drag.start.y, false);
      return;
    }
    if (drag.kind === "draw") {
      setDrag({ ...drag, end: { x: snap(p.x, step), y: snap(p.y, step) } });
      return;
    }
    if (drag.kind === "room") {
      if (!noteSlop(e)) return;
      const dx = snap(p.x - drag.start.x, step);
      const dy = snap(p.y - drag.start.y, step);
      if (!dx && !dy && !drag.moved) return;
      let next = translate(drag.points, dx, dy);
      const others = property.rooms.filter((r) => r.id !== drag.roomId).map((r) => r.points);
      const m = magnetOffset(next, others, 14 / view.scale);
      next = translate(next, m.dx, m.dy);
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setRoomPoints(drag.roomId, next);
      return;
    }
    if (drag.kind === "label") {
      noteSlop(e);
      const src = drag.points;
      const a = src[drag.index];
      const b = src[(drag.index + 1) % src.length];
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (span < 1e-6) return;
      const ux = (b.x - a.x) / span;
      const uy = (b.y - a.y) / span;
      const along =
        ((e.clientX - drag.ax) / view.scale) * ux + ((e.clientY - drag.ay) / view.scale) * uy;
      const min = property.units === "ft" ? 0.5 : 0.15;
      const length = Math.max(min, snapWallLength(drag.base + along, property.units, wallSnapInches()));
      const next = setWallLength(src, drag.index, length);
      if (!next) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setRoomPoints(drag.roomId, next);
      return;
    }
    if (drag.kind === "corner" || drag.kind === "wall" || drag.kind === "seam") noteSlop(e);
    if (drag.kind === "stairs") {
      if (!noteSlop(e)) return;
      const x = drag.x + snap(p.x - drag.start.x, step);
      const y = drag.y + snap(p.y - drag.start.y, step);
      preview((prop) => ({
        ...prop,
        stairs: prop.stairs.map((st) => (st.id === drag.id ? { ...st, x, y } : st)),
      }));
      return;
    }
    if (drag.kind === "corner") {
      setRoomPoints(
        drag.roomId,
        moveCorner(drag.points, drag.index, { x: snap(p.x, step), y: snap(p.y, step) }),
      );
      return;
    }
    if (drag.kind === "wall") {
      const a = drag.points[drag.index];
      const b = drag.points[(drag.index + 1) % drag.points.length];
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const d = snap(horizontal ? p.y - drag.start.y : p.x - drag.start.x, step);
      const next = moveWall(drag.points, drag.index, d);
      if (edges(next).every((ed) => ed.length >= step)) setRoomPoints(drag.roomId, next);
      return;
    }
    if (drag.kind === "seam") {
      const dPlan = drag.pile === 90 ? drag.start.x - p.x : p.y - drag.start.y;
      const dFt = property.units === "ft" ? dPlan : dPlan / 0.3048;
      const lead = property.rooms.find((r) => r.id === drag.roomIds[0]);
      const width = lead ? roomFlooring(lead, property.job).rollWidthFt : 12;
      let next = drag.offsetFt + dFt;
      next = ((next % width) + width) % width;
      const offsetFt = Math.round(next * 100) / 100;
      preview((prop) => ({
        ...prop,
        rooms: prop.rooms.map((r) =>
          drag.roomIds.includes(r.id)
            ? { ...r, flooring: { ...r.flooring, seamOffsetFt: offsetFt } }
            : r,
        ),
      }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (labelPending.current) {
      const pending = labelPending.current;
      labelPending.current = null;
      if (labelWait.current) window.clearTimeout(labelWait.current);
      labelWait.current = null;
      select(pending.roomId);
      onWallTap(pending.roomId, pending.index);
      return;
    }
    if (!drag) return;
    if (drag.kind === "pinch") {
      if (pointers.current.size === 0) setDrag(null);
      return;
    }
    if (drag.kind === "draw") {
      const x = Math.min(drag.start.x, drag.end.x);
      const y = Math.min(drag.start.y, drag.end.y);
      const w = Math.abs(drag.end.x - drag.start.x);
      const h = Math.abs(drag.end.y - drag.start.y);
      if (w >= step * 2 && h >= step * 2) {
        addRoom(
          newRoom(drawName || `Room ${property.rooms.length + 1}`, rectPoints(x, y, w, h), "draw"),
        );
        onModeDone();
      }
      setDrag(null);
      return;
    }
    if (drag.kind === "label") {
      commitDrag();
      if (!drag.moved && !press.current.menu) {
        select(drag.roomId);
        onWallTap(drag.roomId, drag.index);
      }
      setDrag(null);
      return;
    }
    if (drag.kind === "room") {
      commitDrag();
      if (!drag.moved && !press.current.menu) {
        select(drag.roomId);
        onRoomTap?.(drag.roomId);
        onOpenMenu?.();
      }
      setDrag(null);
      return;
    }
    if (drag.kind === "stairs") {
      commitDrag();
      if (!press.current.menu) {
        selectStairs(drag.id);
        onOpenMenu?.();
      }
      setDrag(null);
      return;
    }
    if (drag.kind === "corner" || drag.kind === "wall" || drag.kind === "trace" || drag.kind === "seam")
      commitDrag();
    setDrag(null);
  };

  // Grid
  const gx0 = Math.floor(-view.tx / view.scale);
  const gy0 = Math.floor(-view.ty / view.scale);
  const gx1 = Math.ceil((size.w - view.tx) / view.scale);
  const gy1 = Math.ceil((size.h - view.ty) / view.scale);
  const major = property.units === "ft" ? 5 : 1;
  const minor = property.units === "ft" ? 1 : 0.5;
  const showMinor = view.scale * minor >= 8;
  const lines: React.ReactNode[] = [];
  for (let x = Math.floor(gx0 / minor) * minor; x <= gx1; x += minor) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    if (!isMajor && !showMinor) continue;
    lines.push(
      <line
        key={`x${x}`}
        x1={x}
        y1={gy0}
        x2={x}
        y2={gy1}
        stroke={isMajor ? "#b9b0a0" : "#ddd5c6"}
        strokeWidth={1 / view.scale}
      />,
    );
  }
  for (let y = Math.floor(gy0 / minor) * minor; y <= gy1; y += minor) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    if (!isMajor && !showMinor) continue;
    lines.push(
      <line
        key={`y${y}`}
        x1={gx0}
        y1={y}
        x2={gx1}
        y2={y}
        stroke={isMajor ? "#b9b0a0" : "#ddd5c6"}
        strokeWidth={1 / view.scale}
      />,
    );
  }

  const px = (n: number) => n / view.scale;
  const selected = property.rooms.find((r) => r.id === selectedRoomId);

  return (
    <div
      ref={wrap}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-[#f6f2e8]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => {
        const r = wrap.current!.getBoundingClientRect();
        const k = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.max(4, Math.min(160, view.scale * k));
        const ratio = scale / view.scale;
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        setView({ scale, tx: mx - (mx - view.tx) * ratio, ty: my - (my - view.ty) * ratio });
      }}
      data-testid="plan-editor"
    >
      <svg width={size.w} height={size.h} className="block">
        <defs>
          <marker
            id="fl-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="#8a3b12" />
          </marker>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {lines}
          {trace && !trace.hidden && traceUrl && (
            <image
              href={traceUrl}
              x={trace.x}
              y={trace.y}
              width={trace.w}
              height={trace.w * trace.aspect}
              opacity={trace.opacity}
              preserveAspectRatio="none"
              transform={`rotate(${trace.rot} ${trace.x} ${trace.y})`}
              pointerEvents="none"
              style={mode === "trace" ? { outline: "2px dashed #b4561d" } : undefined}
            />
          )}
          {property.rooms.map((room) => {
            const d = room.points.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join(" ") + " Z";
            const isSel = room.id === selectedRoomId;
            return (
              <path
                key={room.id}
                d={d}
                fill={isSel ? "#efe2c6" : "#fbf7ed"}
                stroke={isSel ? "#b4561d" : "#1c1b18"}
                strokeWidth={px(isSel ? 4 : 3)}
                strokeLinejoin="miter"
              />
            );
          })}
          {(seamEdit || property.showSeams !== false) &&
            carpetPlans(property).flatMap((plan) =>
              plan.layout.marks.map((sm, i) => (
                <g key={`seam${plan.roomIds.join("-")}${i}`}>
                  {seamEdit && sm.kind === "seam" && (
                    <line
                      x1={sm.a.x}
                      y1={sm.a.y}
                      x2={sm.b.x}
                      y2={sm.b.y}
                      stroke="transparent"
                      strokeWidth={px(22)}
                      data-h="seam"
                      data-rooms={sm.roomIds.join(",")}
                      data-pile={String(plan.layout.pileDeg)}
                    />
                  )}
                  <line
                    x1={sm.a.x}
                    y1={sm.a.y}
                    x2={sm.b.x}
                    y2={sm.b.y}
                    stroke={sm.kind === "t" ? "#9a3412" : "#d0342c"}
                    strokeWidth={px(sm.kind === "t" ? 3 : 2)}
                    strokeDasharray={sm.kind === "t" ? undefined : `${px(8)} ${px(5)}`}
                    pointerEvents="none"
                  />
                </g>
              )),
            )}
          {(seamEdit || property.showSeams !== false) &&
            carpetPlans(property).flatMap((plan) =>
              plan.layout.pieces
                .filter((piece) => piece.corners.length >= 3)
                .map((piece) => {
                  const c = {
                    x: piece.corners.reduce((s, q) => s + q.x, 0) / piece.corners.length,
                    y: piece.corners.reduce((s, q) => s + q.y, 0) / piece.corners.length,
                  };
                  const len = px(18);
                  return (
                    <g key={`pc${piece.n}`} pointerEvents="none">
                      <line
                        x1={c.x}
                        y1={c.y}
                        x2={c.x + piece.pile.x * len}
                        y2={c.y + piece.pile.y * len}
                        stroke="#1d4e89"
                        strokeWidth={px(1.5)}
                      />
                      <text
                        x={c.x}
                        y={c.y - px(4)}
                        fontSize={px(12)}
                        fontWeight={700}
                        textAnchor="middle"
                        fill="#9a3412"
                      >
                        {piece.n}
                      </text>
                    </g>
                  );
                }),
            )}
          {property.openings.map((o) => {
            const room = property.rooms.find((r) => r.id === o.roomId);
            const seg = room && openingSegment(room, o);
            if (!seg) return null;
            const w = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
            const tip = { x: seg.a.x + seg.inward.x * w, y: seg.a.y + seg.inward.y * w };
            return (
              <g key={o.id}>
                {o.id === selectedOpeningId && (
                  <line
                    x1={seg.a.x}
                    y1={seg.a.y}
                    x2={seg.b.x}
                    y2={seg.b.y}
                    stroke="#b4561d"
                    strokeOpacity={0.45}
                    strokeWidth={px(16)}
                    strokeLinecap="round"
                  />
                )}
                <line
                  x1={seg.a.x}
                  y1={seg.a.y}
                  x2={seg.b.x}
                  y2={seg.b.y}
                  stroke="#f6f2e8"
                  strokeWidth={px(7)}
                />
                {o.kind === "window" && (
                  <line
                    x1={seg.a.x}
                    y1={seg.a.y}
                    x2={seg.b.x}
                    y2={seg.b.y}
                    stroke="#2f6fb3"
                    strokeWidth={px(3)}
                  />
                )}
                {o.kind === "door" && (
                  <path
                    d={`M${seg.a.x} ${seg.a.y} L${tip.x} ${tip.y} A${w} ${w} 0 0 0 ${seg.b.x} ${seg.b.y}`}
                    fill="none"
                    stroke="#1c1b18"
                    strokeWidth={px(1.5)}
                  />
                )}
              </g>
            );
          })}
          {property.stairs.map((st) => {
            const r = stairsRect(st);
            const isSel = st.id === selectedStairsId;
            const a = stairsArrow(st);
            const fs = Math.max(px(13), Math.min(0.9 / unitPx, px(20)));
            const to = st.toLevelId
              ? property.levels.find((l) => l.id === st.toLevelId)?.name
              : undefined;
            return (
              <g key={st.id} data-testid="stairs">
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill={isSel ? "#efe2c6" : "#ffffff"}
                  stroke={isSel ? "#b4561d" : "#1c1b18"}
                  strokeWidth={px(isSel ? 4 : 2.5)}
                />
                {stairsTreads(st, property.units).map((t, i) => (
                  <line
                    key={i}
                    x1={t.a.x}
                    y1={t.a.y}
                    x2={t.b.x}
                    y2={t.b.y}
                    stroke="#6b665c"
                    strokeWidth={px(1.2)}
                  />
                ))}
                <line
                  x1={a.from.x}
                  y1={a.from.y}
                  x2={a.to.x}
                  y2={a.to.y}
                  stroke="#8a3b12"
                  strokeWidth={px(3)}
                  markerEnd="url(#fl-arrow)"
                />
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 + fs * 0.35}
                  fontSize={fs}
                  fontWeight={800}
                  textAnchor="middle"
                  fill="#1c1b18"
                  stroke="#fff"
                  strokeWidth={px(4)}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {stairsLabel(st)}
                </text>
                {to && (
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 + fs * 1.4}
                    fontSize={fs * 0.7}
                    textAnchor="middle"
                    fill="#5c574d"
                    stroke="#fff"
                    strokeWidth={px(3)}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    to {to}
                  </text>
                )}
              </g>
            );
          })}
          {(() => {
            const placedLabels: ScreenBox[] = [];
            return property.rooms.map((room) => {
            const c = centroid(room.points);
            const fs = Math.max(px(13), Math.min(1.1 / unitPx, px(22)));
            const thumbW = px(64);
            return (
              <g key={`l${room.id}`}>
                <text
                  x={c.x}
                  y={c.y}
                  fontSize={fs}
                  fontWeight={700}
                  textAnchor="middle"
                  fill="#1c1b18"
                  pointerEvents="none"
                >
                  {room.name}
                </text>
                {view.scale >= 16 && closureGap(room.points) > 0.08 && (
                  <text
                    x={c.x}
                    y={c.y - fs * 1.6}
                    fontSize={fs * 0.65}
                    fontWeight={700}
                    textAnchor="middle"
                    fill="#8a3b12"
                    pointerEvents="none"
                  >
                    Gap {formatLength(closureGap(room.points), property.units)}
                  </text>
                )}
                  <text
                    x={c.x}
                    y={c.y + fs * 1.15}
                    fontSize={fs * (room.closet ? 0.62 : 0.75)}
                    textAnchor="middle"
                    fill="#5c574d"
                    pointerEvents="none"
                  >
                    {room.closet
                      ? closetPlanLabel(
                          property.rooms.find((r) => r.id === room.closet?.parentId)?.name ?? "Room",
                          room.name,
                          room.points,
                          property.units,
                        )
                      : formatArea(
                          property.rooms.some(
                            (c) => c.closet?.parentId === room.id && c.closet.includeInParent,
                          )
                            ? listedArea(property, room)
                            : area(room.points),
                          property.units,
                        )}
                  </text>
                {view.scale >= 18 && room.photos.slice(0, 3).map((ph, i, shown) => (
                  <image
                    key={ph.id}
                    data-h="photo"
                    data-room={room.id}
                    data-photo={ph.id}
                    href={ph.thumb}
                    x={c.x - (shown.length * (thumbW + px(4))) / 2 + i * (thumbW + px(4))}
                    y={c.y + fs * 1.5}
                    width={thumbW}
                    height={thumbW * 0.75}
                    preserveAspectRatio="xMidYMid slice"
                    style={{ cursor: "pointer" }}
                  />
                ))}
                {(room.id === selectedRoomId || view.scale >= 14) && layoutWallLabels(edges(room.points), view, placedLabels).map(({ e, x: tx, y: ty }) => {
                  const label = formatLength(e.length, property.units);
                  const bw = px(label.length * 7.5 + 14);
                  const bh = px(22);
                  const hit = px(44);
                  return (
                    <g
                      key={e.index}
                      data-h="label"
                      data-room={room.id}
                      data-i={e.index}
                      transform={`translate(${tx} ${ty}) rotate(${labelRotation(e)})`}
                      style={{ cursor: "pointer" }}
                    >
                      <rect x={-Math.max(bw, hit) / 2} y={-hit / 2} width={Math.max(bw, hit)} height={hit} fill="transparent" />
                      <rect
                        x={-bw / 2}
                        y={-bh / 2}
                        width={bw}
                        height={bh}
                        rx={px(5)}
                        fill="#fff"
                        stroke="#c9b9a0"
                        strokeWidth={px(1)}
                      />
                      <text
                        y={px(4.5)}
                        fontSize={px(13)}
                        textAnchor="middle"
                        fill="#8a3b12"
                        fontWeight={600}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          });
          })()}
          {selected && focusWall != null && edges(selected.points)[focusWall] && (
            <line
              x1={edges(selected.points)[focusWall].a.x}
              y1={edges(selected.points)[focusWall].a.y}
              x2={edges(selected.points)[focusWall].b.x}
              y2={edges(selected.points)[focusWall].b.y}
              stroke="#b4561d"
              strokeWidth={px(8)}
              strokeLinecap="round"
              pointerEvents="none"
            />
          )}
          {draft && draftOrigin && (
            <g transform={`translate(${draftOrigin.x} ${draftOrigin.y})`} pointerEvents="none">
              {draft.points.length > 1 && (
                <polyline
                  points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#b4561d"
                  strokeWidth={px(3)}
                  strokeDasharray={`${px(7)} ${px(4)}`}
                />
              )}
              {(draft.openCloset ?? draft.points).length > 0 && draft.preview && (
                <line
                  x1={(draft.openCloset ?? draft.points).at(-1)!.x}
                  y1={(draft.openCloset ?? draft.points).at(-1)!.y}
                  x2={draft.preview.x}
                  y2={draft.preview.y}
                  stroke="#b4561d"
                  strokeWidth={px(2)}
                  markerEnd="url(#fl-arrow)"
                />
              )}
              {draft.points.map((p, i) => (
                <circle key={`d${i}`} cx={p.x} cy={p.y} r={px(4.5)} fill="#b4561d" />
              ))}
              {draft.closets.map((pts, i) => (
                <polygon
                  key={`c${i}`}
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="#efe2c6"
                  stroke="#8a3b12"
                  strokeWidth={px(2)}
                />
              ))}
              {draft.openings.map((seg, i) => (
                <line
                  key={`o${i}`}
                  x1={seg.a.x}
                  y1={seg.a.y}
                  x2={seg.b.x}
                  y2={seg.b.y}
                  stroke="#f6f2e8"
                  strokeWidth={px(7)}
                />
              ))}
            </g>
          )}
          {selected && mode === "select" && isRectilinear(selected.points) && (() => {
            const b = bbox(selected.points);
            return (b.maxX - b.minX) * view.scale >= 120 && (b.maxY - b.minY) * view.scale >= 120;
          })() && (
            <g>
              {edges(selected.points).map((e) => (
                <rect
                  key={`w${e.index}`}
                  data-h="wall"
                  data-room={selected.id}
                  data-i={e.index}
                  x={(e.a.x + e.b.x) / 2 - px(e.horizontal ? 18 : 9)}
                  y={(e.a.y + e.b.y) / 2 - px(e.horizontal ? 9 : 18)}
                  width={px(e.horizontal ? 36 : 18)}
                  height={px(e.horizontal ? 18 : 36)}
                  rx={px(6)}
                  fill="#b4561d"
                  opacity={0.9}
                  style={{ cursor: e.horizontal ? "ns-resize" : "ew-resize" }}
                />
              ))}
              {selected.points.map((q, i) => (
                <g
                  key={`c${i}`}
                  data-h="corner"
                  data-room={selected.id}
                  data-i={i}
                  style={{ cursor: "move" }}
                >
                  <circle cx={q.x} cy={q.y} r={px(HANDLE_PX)} fill="transparent" />
                  <circle
                    cx={q.x}
                    cy={q.y}
                    r={px(9)}
                    fill="#fff"
                    stroke="#b4561d"
                    strokeWidth={px(3)}
                  />
                </g>
              ))}
            </g>
          )}
          {drag?.kind === "draw" && (
            <rect
              x={Math.min(drag.start.x, drag.end.x)}
              y={Math.min(drag.start.y, drag.end.y)}
              width={Math.abs(drag.end.x - drag.start.x)}
              height={Math.abs(drag.end.y - drag.start.y)}
              fill="#b4561d22"
              stroke="#b4561d"
              strokeWidth={px(2)}
              strokeDasharray={`${px(6)} ${px(4)}`}
            />
          )}
          {calPts.map((q, i) => (
            <circle key={i} cx={q.x} cy={q.y} r={px(9)} fill="#b4561d" stroke="#fff" strokeWidth={px(3)} />
          ))}
          {/* Big invisible tap targets so doors / windows can be picked with a thumb. */}
          {property.openings.map((o) => {
            const room = property.rooms.find((r) => r.id === o.roomId);
            const seg = room && openingSegment(room, o);
            if (!seg) return null;
            return (
              <line
                key={`hit-${o.id}`}
                data-h="opening"
                data-room={o.roomId}
                data-opening={o.id}
                x1={seg.a.x}
                y1={seg.a.y}
                x2={seg.b.x}
                y2={seg.b.y}
                stroke="transparent"
                strokeWidth={px(30)}
                style={{ cursor: "pointer" }}
              />
            );
          })}
        </g>
      </svg>
      {drag?.kind === "draw" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-base font-semibold text-white">
          {formatLength(Math.abs(drag.end.x - drag.start.x), property.units)} ×{" "}
          {formatLength(Math.abs(drag.end.y - drag.start.y), property.units)}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex flex-col gap-2">
        <ZoomBtn label="+" onClick={() => zoomBy(1.4)} />
        <ZoomBtn label="−" onClick={() => zoomBy(1 / 1.4)} />
        <ZoomBtn label="Fit" onClick={fit} />
      </div>
    </div>
  );

  function zoomBy(k: number) {
    const el = wrap.current;
    const w = el?.clientWidth || size.w;
    const h = el?.clientHeight || size.h;
    const scale = Math.max(4, Math.min(160, view.scale * k));
    const ratio = scale / view.scale;
    const mx = w / 2;
    const my = h / 2;
    setView({ scale, tx: mx - ((mx - view.tx) * ratio), ty: my - ((my - view.ty) * ratio) });
  }
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="flex size-12 items-center justify-center rounded-full border border-black/15 bg-white text-lg font-bold shadow"
      aria-label={label === "Fit" ? "Fit plan to screen" : label === "+" ? "Zoom in" : "Zoom out"}
    >
      {label}
    </button>
  );
}
