import { DoorOpen, ScanLine, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WalkRoom } from "./walk-mode";
import { ArScan } from "@/lib/field/arcore";
import { ArScanner, isFloor, isWall, scalePts, toPlan, type ScanRoom } from "@/lib/field/arscan";
import { FT_PER_M } from "@/lib/field/deadreckon";
import { bbox, defaultOpeningWidth, formatLength, type Pt, type Units } from "@/lib/field/model";

const GRID_M = 0.05;

/**
 * Continuous ARCore scan (Beta 2). The camera preview is drawn natively behind
 * the (transparent) WebView; this overlay shows a live top-down map of the
 * detected walls/floor, the walked path and the auto-built room outline.
 */
export function ArCoreScan({
  units,
  firstName,
  roomCount,
  onDone,
  onCancel,
}: {
  units: Units;
  firstName: string;
  roomCount: number;
  onDone: (rooms: WalkRoom[], doorWidth: number) => void;
  onCancel: (reason?: string) => void;
}) {
  const scanner = useRef(new ArScanner());
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<string>("Starting camera…");
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("ar-scan-active");
    let handle: { remove: () => Promise<void> } | null = null;
    let alive = true;
    void (async () => {
      try {
        handle = await ArScan.addListener("frame", (f) => {
          scanner.current.push(f);
          setTick((t) => t + 1);
        });
        if (!alive) return void handle.remove();
        const r = await ArScan.start();
        // Closed while the permission/install prompt was up: don't leave a
        // headless AR session holding the camera behind a transparent page.
        if (!alive) return void ArScan.stop().catch(() => {});
        setDepth(r.depth);
        setStatus("Scanning");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      document.documentElement.classList.remove("ar-scan-active");
      void handle?.remove();
      void ArScan.stop().catch(() => {});
    };
  }, []);

  const s = scanner.current;
  const k = units === "ft" ? FT_PER_M : 1;
  const roomName = (i: number) => (i === 0 ? firstName : `Room ${roomCount + i + 1}`);

  const toWalk = (rooms: ScanRoom[]): WalkRoom[] =>
    rooms.map((r, i) => ({
      name: roomName(i),
      points: scalePts(r.points, k),
      door: r.door
        ? { at: { x: r.door.x * k, y: r.door.y * k }, raw: { x: r.door.x * k, y: r.door.y * k } }
        : null,
    }));

  const newRoom = () => {
    if (s.tracking !== "TRACKING")
      return setError("Tracking lost — hold still and look at the floor.");
    if (!s.newRoom(GRID_M)) return setError("Walk around this room first.");
    setError(null);
    navigator.vibrate?.([30, 40, 30]);
    setTick((t) => t + 1);
  };
  const finish = () => {
    const all = s.finish(GRID_M);
    if (!all.length) return setError("Walk around at least one room first.");
    onDone(toWalk(all), defaultOpeningWidth("door", units));
  };

  // ------- live map (metres, frame space) -------
  const a = s.angle ?? 0;
  const planes = [...s.planes.values()];
  const live = s.path.length ? s.live(GRID_M) : null;
  const outline = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const here = s.here();
  const head = s.heading();
  const pts: Pt[] = [
    ...s.rooms.flatMap((r) => r.points),
    ...(live?.points ?? []),
    ...(here ? [here] : []),
  ];
  const b = bbox(pts.length ? pts : [{ x: 0, y: 0 }]);
  const span = Math.max(b.w, b.h, 5);
  const pad = span * 0.1;
  const vb = `${b.minX - pad} ${b.minY - pad} ${span + pad * 2} ${span + pad * 2}`;
  const sw = span / 150;
  const { walls, floors } = s.counts();
  const lw = live ? bbox(live.points) : null;
  void tick;

  const hint =
    error ??
    (s.tracking !== "TRACKING"
      ? `Move the phone slowly and point it at the floor and walls${s.failure && s.failure !== "NONE" ? ` (${s.failure.toLowerCase().replace(/_/g, " ")})` : ""}.`
      : walls === 0
        ? "Point the camera at the walls as you walk — sweep slowly so ARCore can find them."
        : "Walk the room, sweeping each wall. Tap New room as you step through a door.");

  return (
    <div className="ar-scan-layer fixed inset-0 z-50 flex flex-col text-white">
      <div
        className="flex items-start gap-2 p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex-1 rounded-xl bg-black/60 px-4 py-3 backdrop-blur">
          <div className="text-sm uppercase tracking-wide text-[#ffd29a]">
            {roomName(s.rooms.length)} · {s.rooms.length} done · {status}
            {depth ? " · depth" : ""}
          </div>
          <div className={`text-lg font-semibold leading-snug ${error ? "text-red-300" : ""}`}>
            {hint}
          </div>
          <div className="mt-1 text-sm text-white/70">
            {walls} walls · {floors} floor planes
            {lw ? ` · now ${formatLength(lw.w * k, units)} × ${formatLength(lw.h * k, units)}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCancel()}
          aria-label="Cancel scan"
          className="flex size-12 items-center justify-center rounded-full bg-black/60"
        >
          <X />
        </button>
      </div>

      <div className="min-h-0 flex-1" />

      <div className="mx-3 h-[38vh] overflow-hidden rounded-2xl bg-black/55 backdrop-blur">
        <svg viewBox={vb} className="h-full w-full">
          {planes.filter(isFloor).map((p) => (
            <polygon
              key={p.id}
              points={outline(p.polygon.map((q) => toPlan(q[0], q[2], a)))}
              fill="#4aa3ff22"
              stroke="none"
            />
          ))}
          {planes.filter(isWall).map((p) => {
            const q = p.polygon.map((v) => toPlan(v[0], v[2], a));
            const xs = q.map((v) => v.x);
            const ys = q.map((v) => v.y);
            return (
              <line
                key={p.id}
                x1={Math.min(...xs)}
                y1={Math.min(...ys)}
                x2={Math.max(...xs)}
                y2={Math.max(...ys)}
                stroke="#ff8a65"
                strokeWidth={sw * 1.5}
              />
            );
          })}
          {s.rooms.map((r, i) => (
            <g key={i}>
              <polygon
                points={outline(r.points)}
                fill="#ffffff14"
                stroke="#9fd3a8"
                strokeWidth={sw}
              />
              {r.door && <circle cx={r.door.x} cy={r.door.y} r={sw * 2.5} fill="#ffd29a" />}
            </g>
          ))}
          {live && (
            <polygon
              points={outline(live.points)}
              fill="none"
              stroke="#ffd29a"
              strokeWidth={sw}
              strokeDasharray={`${sw * 3} ${sw * 2}`}
            />
          )}
          <polyline points={outline(s.path)} fill="none" stroke="#fff8" strokeWidth={sw / 1.5} />
          {here && head != null && (
            <line
              x1={here.x}
              y1={here.y}
              x2={here.x + Math.cos(head) * span * 0.06}
              y2={here.y + Math.sin(head) * span * 0.06}
              stroke="#fff"
              strokeWidth={sw}
            />
          )}
          {here && (
            <circle
              cx={here.x}
              cy={here.y}
              r={sw * 3}
              fill="#b4561d"
              stroke="#fff"
              strokeWidth={sw / 2}
            />
          )}
        </svg>
      </div>

      <div
        className="space-y-2 p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={newRoom}
          className="flex h-20 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-2xl font-bold"
        >
          <DoorOpen className="size-7" /> New room
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              s.undoRoom();
              setTick((t) => t + 1);
            }}
            disabled={!s.rooms.length}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/60 disabled:opacity-40"
          >
            <Undo2 className="size-5" /> Undo room
          </button>
          <button
            type="button"
            onClick={finish}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[#2f7d4a] font-bold"
          >
            <ScanLine className="size-5" /> Finish
          </button>
        </div>
      </div>
    </div>
  );
}
