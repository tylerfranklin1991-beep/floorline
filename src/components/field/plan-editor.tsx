import { carpetLayout, roomFlooring } from "@/lib/field/materials";
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
  pointInPolygon,
  rectPoints,
  snap,
  translate,
  uid,
  type FieldProperty,
  type Pt,
} from "@/lib/field/model";
import { useField } from "@/lib/field/store";

export type EditorMode = "select" | "draw" | "door" | "window" | "opening" | "stairs";

type View = { scale: number; tx: number; ty: number };

type Drag =
  | { kind: "pan"; start: Pt; view: View }
  | { kind: "room"; roomId: string; start: Pt; points: Pt[]; moved: boolean }
  | { kind: "corner"; roomId: string; index: number; points: Pt[] }
  | { kind: "wall"; roomId: string; index: number; start: Pt; points: Pt[] }
  | { kind: "draw"; start: Pt; end: Pt }
  | { kind: "stairs"; id: string; start: Pt; x: number; y: number }
  | { kind: "pinch"; d0: number; mid0: Pt; view: View };

const HANDLE_PX = 22;

export function PlanEditor({
  property,
  mode,
  onModeDone,
  onWallTap,
  onPhotoTap,
  onOpeningTap,
  fitNonce,
  drawName,
}: {
  property: FieldProperty;
  mode: EditorMode;
  onModeDone: () => void;
  onWallTap: (roomId: string, wall: number) => void;
  onPhotoTap: (roomId: string, photoId: string) => void;
  /** Tap on a door / window / doorway. */
  onOpeningTap?: (roomId: string, openingId: string) => void;
  fitNonce: number;
  drawName?: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [view, setView] = useState<View>({ scale: 24, tx: 40, ty: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
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
  const step = gridStep(property.units);
  const unitPx = property.units === "ft" ? 1 : 3.2808;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
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

  useEffect(() => {
    fit();
  }, [fit, fitNonce]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    if (h === "label" && room) {
      onWallTap(room.id, Number(target!.dataset.i));
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
    const st = [...property.stairs].reverse().find((x) => {
      const r = stairsRect(x);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (st) {
      selectStairs(st.id);
      beginDrag();
      setDrag({ kind: "stairs", id: st.id, start: p, x: st.x, y: st.y });
      return;
    }
    const hit = roomAt(p);
    if (hit) {
      select(hit.id);
      beginDrag();
      setDrag({ kind: "room", roomId: hit.id, start: p, points: hit.points, moved: false });
      return;
    }
    select(null);
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
    if (drag.kind === "draw") {
      setDrag({ ...drag, end: { x: snap(p.x, step), y: snap(p.y, step) } });
      return;
    }
    if (drag.kind === "room") {
      const dx = snap(p.x - drag.start.x, step);
      const dy = snap(p.y - drag.start.y, step);
      if (!dx && !dy && !drag.moved) return;
      let next = translate(drag.points, dx, dy);
      const others = property.rooms.filter((r) => r.id !== drag.roomId).map((r) => r.points);
      const m = magnetOffset(next, others, 14 / view.scale);
      next = translate(next, m.dx, m.dy);
      if (!drag.moved && (dx || dy)) setDrag({ ...drag, moved: true });
      setRoomPoints(drag.roomId, next);
      return;
    }
    if (drag.kind === "stairs") {
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
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
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
    if (
      drag.kind === "room" ||
      drag.kind === "corner" ||
      drag.kind === "wall" ||
      drag.kind === "stairs"
    )
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
          {property.showSeams !== false &&
            property.rooms.map((room) =>
              roomFlooring(room, property.job).material === "carpet"
                ? carpetLayout(room, property.units, roomFlooring(room, property.job)).seams.map((sm, i) => (
                    <line
                      key={`seam${room.id}${i}`}
                      x1={sm.a.x}
                      y1={sm.a.y}
                      x2={sm.b.x}
                      y2={sm.b.y}
                      stroke="#d0342c"
                      strokeWidth={px(2)}
                      strokeDasharray={`${px(8)} ${px(5)}`}
                      pointerEvents="none"
                    />
                  ))
                : null,
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
          {property.rooms.map((room) => {
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
                <text
                  x={c.x}
                  y={c.y + fs * 1.15}
                  fontSize={fs * 0.75}
                  textAnchor="middle"
                  fill="#5c574d"
                  pointerEvents="none"
                >
                  {formatArea(area(room.points), property.units)}
                </text>
                {room.photos.slice(0, 3).map((ph, i, shown) => (
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
                {edges(room.points).map((e) => {
                  const L = e.length || 1;
                  const nx = -(e.b.y - e.a.y) / L;
                  const ny = (e.b.x - e.a.x) / L;
                  const tx = (e.a.x + e.b.x) / 2 + nx * px(30);
                  const ty = (e.a.y + e.b.y) / 2 + ny * px(30);
                  const label = formatLength(e.length, property.units);
                  const bw = px(label.length * 7.5 + 14);
                  const bh = px(22);
                  return (
                    <g
                      key={e.index}
                      data-h="label"
                      data-room={room.id}
                      data-i={e.index}
                      transform={`translate(${tx} ${ty}) rotate(${e.horizontal ? 0 : -90})`}
                      style={{ cursor: "pointer" }}
                    >
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
          })}
          {selected && mode === "select" && (
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
      {mode !== "select" && !drag && (
        <div className="pointer-events-none absolute left-1/2 top-3 w-[90%] max-w-md -translate-x-1/2 rounded-xl bg-[#b4561d] px-4 py-3 text-center text-base font-semibold text-white shadow-lg">
          {mode === "draw"
            ? "Drag on the grid to draw a room"
            : mode === "stairs"
              ? "Tap where the stairs go"
              : `Tap a wall to place the ${mode === "opening" ? "doorway" : mode}`}
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
    const scale = Math.max(4, Math.min(160, view.scale * k));
    const ratio = scale / view.scale;
    const mx = size.w / 2;
    const my = size.h / 2;
    setView({ scale, tx: mx - (mx - view.tx) * ratio, ty: my - (my - view.ty) * ratio });
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
