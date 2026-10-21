import {
  Camera,
  DoorOpen,
  Footprints,
  Pause,
  Play,
  Ruler,
  Undo2,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  advance,
  compassHeading,
  DEFAULT_STRIDE_M,
  dominantFrameAngle,
  toFrame,
  FT_PER_M,
  HeadingFilter,
  roomFromTrace,
  snapToAxis,
  StepDetector,
  strideFromCalibration,
} from "@/lib/field/deadreckon";
import {
  bbox,
  defaultOpeningWidth,
  formatLength,
  gridStep,
  MAX_PHOTOS_PER_ROOM,
  parseLength,
  type Pt,
  type Units,
} from "@/lib/field/model";
import { prepareFromSource, type PreparedPhoto } from "@/lib/field/photos";
import { useCamera } from "@/lib/field/use-camera";

/** A walked room in plan space; `door.at` is where you left it (room frame), `raw` the path point. */
export type WalkRoom = {
  name: string;
  points: Pt[];
  door: { at: Pt; raw: Pt } | null;
  /** Snapshots taken while walking this room (max MAX_PHOTOS_PER_ROOM). */
  photos?: PreparedPhoto[];
};
const STRIDE_KEY = "floorline-stride-m";

function loadStrideM(): number {
  const v = Number(globalThis.localStorage?.getItem(STRIDE_KEY));
  return v > 0.2 && v < 2 ? v : DEFAULT_STRIDE_M;
}

/** Ask for motion/orientation access (needed on iOS; a no-op in Android WebView/Chrome). */
async function requestSensors(): Promise<boolean> {
  try {
    const DM = globalThis.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    const DO = globalThis.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DM?.requestPermission === "function" && (await DM.requestPermission()) !== "granted")
      return false;
    if (typeof DO?.requestPermission === "function" && (await DO.requestPermission()) !== "granted")
      return false;
    return typeof globalThis.DeviceMotionEvent !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Continuous walk mode: counts steps from the accelerometer and reads the
 * compass to dead-reckon a live path. Walk along the walls of a room, tap
 * "Doorway / New room" as you pass through a door, repeat, then Finish.
 */
export function WalkMode({
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
  onCancel: () => void;
}) {
  const toUnits = (m: number) => (units === "ft" ? m * FT_PER_M : m);
  const [strideM, setStrideM] = useState(loadStrideM);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [sensorMsg, setSensorMsg] = useState<string | null>(null);
  const [trace, setTrace] = useState<Pt[]>([{ x: 0, y: 0 }]);
  const [rooms, setRooms] = useState<WalkRoom[]>([]);
  const [heading, setHeading] = useState<number | null>(null);
  const [steps, setSteps] = useState(0);
  const [calib, setCalib] = useState<null | { steps: number; on: boolean; dist: string }>(null);
  const [frameAngle, setFrameAngle] = useState<number | null>(null);
  const [gotMotion, setGotMotion] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const cam = useCamera(video, camOn);

  const st = useRef({
    detector: new StepDetector(),
    filter: new HeadingFilter(0.12),
    lastHeadingUi: 0,
    gotMotion: false,
    start: null as number | null,
    pos: { x: 0, y: 0 } as Pt,
    running: false,
    calibrating: false,
    stride: toUnits(strideM),
  });
  st.current.running = running;
  st.current.calibrating = !!calib?.on;
  st.current.stride = toUnits(strideM);

  useEffect(() => {
    if (!started) return;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const s = st.current;
      if (!s.gotMotion) {
        s.gotMotion = true;
        setGotMotion(true);
      }
      if (!s.detector.push(Math.hypot(a.x, a.y, a.z), performance.now())) return;
      if (s.calibrating) {
        setCalib((c) => (c ? { ...c, steps: c.steps + 1 } : c));
        return;
      }
      if (!s.running) return;
      const h = s.filter.value();
      if (h == null) return;
      if (s.start == null) s.start = h;
      s.pos = advance(s.pos, snapToAxis(h - s.start), s.stride);
      setSteps((n) => n + 1);
      setTrace((t) => [...t, s.pos]);
    };
    let sawAbsolute = false;
    const onOrient = (absolute: boolean) => (e: DeviceOrientationEvent) => {
      if (absolute) sawAbsolute = true;
      else if (sawAbsolute) return;
      const h = compassHeading(e as DeviceOrientationEvent & { webkitCompassHeading?: number });
      if (h == null) return;
      const v = st.current.filter.push(h);
      // Re-rendering the plan on every 60 Hz sensor event made the UI stutter.
      const now = performance.now();
      if (now - st.current.lastHeadingUi > 100) {
        st.current.lastHeadingUi = now;
        setHeading(v);
      }
    };
    const abs = onOrient(true);
    const rel = onOrient(false);
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientationabsolute" as "deviceorientation", abs);
    window.addEventListener("deviceorientation", rel);
    // The screen wake lock is dropped by the browser whenever the page is
    // hidden, so take it again every time we come back.
    type Lock = { release: () => Promise<void>; released?: boolean };
    let lock: Lock | null = null;
    let disposed = false;
    const takeLock = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<Lock> } })
        .wakeLock;
      if (!wl || (lock && !lock.released)) return;
      wl.request("screen")
        .then((l) => {
          if (disposed) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    };
    const attach = () => {
      window.addEventListener("devicemotion", onMotion);
      window.addEventListener("deviceorientationabsolute" as "deviceorientation", abs);
      window.addEventListener("deviceorientation", rel);
    };
    const detach = () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientationabsolute" as "deviceorientation", abs);
      window.removeEventListener("deviceorientation", rel);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        // Steps taken while away can't be tracked: pause so the path stays honest.
        if (st.current.running) {
          setRunning(false);
          setSensorMsg("Walk paused while the app was in the background. Tap Resume.");
        }
        return;
      }
      // Resume: fresh sensor state and listeners (some WebViews stop delivering after a pause).
      detach();
      st.current.detector.reset();
      st.current.filter.reset();
      sawAbsolute = false;
      attach();
      takeLock();
    };
    attach();
    takeLock();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      detach();
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => {
      if (!gotMotion)
        setSensorMsg("No motion sensor readings yet. This phone/browser may not share them.");
    }, 4000);
    return () => clearTimeout(t);
  }, [started, gotMotion]);

  const begin = async () => {
    const ok = await requestSensors();
    if (!ok) {
      setSensorMsg("Motion access was blocked. Allow motion & orientation, then try again.");
      return;
    }
    setSensorMsg(null);
    setStarted(true);
    setRunning(true);
  };

  const snapshot = async () => {
    if (!video.current || cam.status !== "live" || photos.length >= MAX_PHOTOS_PER_ROOM) return;
    try {
      const p = await prepareFromSource(video.current);
      setPhotos((x) => (x.length >= MAX_PHOTOS_PER_ROOM ? x : [...x, p]));
      navigator.vibrate?.(40);
    } catch {
      setSensorMsg("Camera isn't ready yet — try the snapshot again.");
    }
  };

  const grid = gridStep(units);
  const tol = units === "ft" ? 1.5 : 0.45;
  const minSize = units === "ft" ? 3 : 1;

  const closeRoom = (): (WalkRoom & { at: Pt }) | null => {
    const angle = frameAngle ?? dominantFrameAngle(trace);
    const pts = roomFromTrace(trace, { tolerance: tol, grid, frameAngle: angle, minSize });
    if (!pts) return null;
    if (frameAngle == null) setFrameAngle(angle);
    return {
      name: rooms.length === 0 ? firstName : `Room ${roomCount + rooms.length + 1}`,
      points: pts,
      door: null,
      at: toFrame(st.current.pos, angle),
    };
  };

  const doorway = () => {
    const r = closeRoom();
    if (!r) {
      setSensorMsg("That room is too small — walk along its walls first.");
      return;
    }
    navigator.vibrate?.([30, 40, 30]);
    setSensorMsg(null);
    const { at, ...room } = r;
    setRooms((x) => [...x, { ...room, photos, door: { at, raw: st.current.pos } }]);
    setPhotos([]);
    setTrace([st.current.pos]);
  };

  const undoRoom = () => {
    const last = rooms[rooms.length - 1];
    if (!last) {
      setTrace([st.current.pos]);
      return;
    }
    setRooms((x) => x.slice(0, -1));
    // Re-walking that room: its snapshots come back to it.
    setPhotos(last.photos ?? []);
    // Back to standing in the doorway, ready to re-walk the next room.
    const back = last.door?.raw ?? st.current.pos;
    setTrace([back]);
    st.current.pos = back;
    if (rooms.length === 1) setFrameAngle(null);
  };

  const finish = () => {
    const r = closeRoom();
    const all: WalkRoom[] = r
      ? [...rooms, { name: r.name, points: r.points, door: null, photos }]
      : rooms;
    if (!all.length) {
      setSensorMsg("Walk around at least one room first.");
      return;
    }
    onDone(all, defaultOpeningWidth("door", units));
  };

  // ------- drawing -------
  const angle = frameAngle ?? 0;
  const rot = (p: Pt) => ({
    x: p.x * Math.cos(-angle) - p.y * Math.sin(-angle),
    y: p.x * Math.sin(-angle) + p.y * Math.cos(-angle),
  });
  const viewPts = [...rooms.flatMap((r) => r.points), ...trace.map(rot)];
  const b = bbox(viewPts.length ? viewPts : [{ x: 0, y: 0 }]);
  const span = Math.max(b.w, b.h, units === "ft" ? 20 : 6);
  const pad = span * 0.12;
  const vb = `${b.minX - pad} ${b.minY - pad} ${span + pad * 2} ${span + pad * 2}`;
  const sw = span / 120;
  const here = rot(trace[trace.length - 1]);
  const rel = heading != null && st.current.start != null ? heading - st.current.start : 0;
  const dir = advance({ x: 0, y: 0 }, rel, span / 18);
  const dirR = rot(dir);
  const dist = trace.length > 1 ? (trace.length - 1) * st.current.stride : 0;

  const hint = !started
    ? "Stand in a corner of the first room, phone flat in front of you, pointing the way you’ll walk. Tap Start."
    : !running
      ? "Paused. Stand still where you stopped, then tap Resume."
      : rooms.length === 0 && trace.length < 6
        ? "Walk slowly along the walls, all the way round the room, keeping the phone pointing forward."
        : "Keep hugging the walls. When you step through a door into the next room, tap Doorway.";

  if (calib) {
    const d = parseLength(calib.dist, units);
    const s = d != null ? strideFromCalibration(d, calib.steps) : null;
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-4 bg-[#111] p-5 text-white">
        <h2 className="text-2xl font-bold">Calibrate your stride</h2>
        <ol className="list-decimal space-y-1 pl-5 text-lg text-white/85">
          <li>
            Measure a straight run, e.g. {units === "ft" ? "20 ft" : "6 m"} (tape, floor tiles).
          </li>
          <li>Tap Start, walk it at your normal pace, tap Stop.</li>
          <li>Type the distance and Save.</li>
        </ol>
        <div className="text-center text-6xl font-bold">{calib.steps}</div>
        <div className="text-center text-white/60">steps counted</div>
        <button
          type="button"
          onClick={async () => {
            if (!started && !(await requestSensors())) {
              setSensorMsg("Motion access was blocked.");
              return;
            }
            setStarted(true);
            setCalib((c) => c && { ...c, on: !c.on, steps: c.on ? c.steps : 0 });
          }}
          className="h-16 rounded-2xl bg-[#b4561d] text-xl font-bold"
        >
          {calib.on ? "Stop" : "Start"}
        </button>
        <input
          inputMode="decimal"
          value={calib.dist}
          onChange={(e) => setCalib({ ...calib, dist: e.target.value })}
          placeholder={`Distance walked (${units})`}
          className="h-14 rounded-xl bg-white/15 px-4 text-xl"
        />
        {s && <p className="text-lg">Stride: {formatLength(s, units)} per step</p>}
        <div className="mt-auto grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCalib(null)}
            className="h-14 rounded-xl bg-white/10"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!s || calib.on}
            onClick={() => {
              const m = units === "ft" ? s! / FT_PER_M : s!;
              localStorage.setItem(STRIDE_KEY, String(m));
              setStrideM(m);
              setCalib(null);
            }}
            className="h-14 rounded-xl bg-[#2f7d4a] font-bold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#111] text-white">
      <div
        className="flex items-start gap-2 p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex-1 rounded-xl bg-white/10 px-4 py-3">
          <div className="text-sm uppercase tracking-wide text-[#ffd29a]">
            {rooms.length === 0 ? firstName : `Room ${roomCount + rooms.length + 1}`} ·{" "}
            {rooms.length} done
          </div>
          <div className="text-lg font-semibold leading-snug">{hint}</div>
          {sensorMsg && <div className="mt-1 text-base text-red-300">{sensorMsg}</div>}
        </div>
        <button
          type="button"
          onClick={() => setCamOn((v) => !v)}
          aria-label={camOn ? "Hide camera" : "Show camera"}
          aria-pressed={camOn}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10"
        >
          {camOn ? <VideoOff /> : <Video />}
        </button>
        <button
          type="button"
          onClick={() => {
            // One mis-tap used to throw away every walked room.
            if ((rooms.length > 0 || trace.length > 5) && !window.confirm("Discard this walk?"))
              return;
            onCancel();
          }}
          aria-label="Cancel walk"
          className="flex size-12 items-center justify-center rounded-full bg-white/10"
        >
          <X />
        </button>
      </div>

      {camOn && (
        <div className="relative mx-3 h-[32vh] shrink-0 overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          {cam.status !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-base text-white/80">
              <p>
                {cam.status === "error"
                  ? cam.error
                  : cam.status === "starting"
                    ? "Starting camera…"
                    : "Camera is off."}
              </p>
              {cam.status !== "starting" && (
                <button
                  type="button"
                  onClick={() => void cam.start()}
                  className="h-12 rounded-xl bg-[#b4561d] px-5 font-bold text-white"
                >
                  Tap to start camera
                </button>
              )}
              <p className="text-xs text-white/60">Walk tracking keeps working without it.</p>
            </div>
          )}
          <button
            type="button"
            onClick={snapshot}
            disabled={cam.status !== "live" || photos.length >= MAX_PHOTOS_PER_ROOM}
            className="absolute bottom-2 right-2 flex h-12 items-center gap-2 rounded-full bg-black/70 px-4 font-bold disabled:opacity-40"
          >
            <Camera className="size-5" /> Snapshot {photos.length}/{MAX_PHOTOS_PER_ROOM}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <svg viewBox={vb} className="h-full w-full">
          {rooms.map((r, i) => (
            <g key={i}>
              <polygon
                points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="#ffffff14"
                stroke="#9fd3a8"
                strokeWidth={sw}
              />
              {r.door && <circle cx={r.door.at.x} cy={r.door.at.y} r={sw * 2.5} fill="#ffd29a" />}
            </g>
          ))}
          <polyline
            points={trace
              .map(rot)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            fill="none"
            stroke="#ffd29a"
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <line
            x1={here.x}
            y1={here.y}
            x2={here.x + dirR.x}
            y2={here.y + dirR.y}
            stroke="#fff"
            strokeWidth={sw}
          />
          <circle
            cx={here.x}
            cy={here.y}
            r={sw * 3}
            fill="#b4561d"
            stroke="#fff"
            strokeWidth={sw / 2}
          />
        </svg>
        <div className="absolute bottom-2 left-3 text-sm text-white/70">
          {steps} steps · {formatLength(dist, units)} · stride{" "}
          {formatLength(st.current.stride, units)}
          {heading == null && started ? " · no compass yet" : ""}
        </div>
      </div>

      <div
        className="space-y-2 p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {!started ? (
          <button
            type="button"
            onClick={begin}
            className="flex h-20 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-2xl font-bold"
          >
            <Footprints className="size-7" /> Start walking
          </button>
        ) : (
          <button
            type="button"
            onClick={doorway}
            disabled={!running}
            className="flex h-20 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-2xl font-bold disabled:opacity-40"
          >
            <DoorOpen className="size-7" /> Doorway / New room
          </button>
        )}
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            disabled={!started}
            className="flex h-14 flex-col items-center justify-center rounded-xl bg-white/10 text-sm disabled:opacity-40"
          >
            {!started || running ? (
              <>
                <Pause className="size-5" /> Pause
              </>
            ) : (
              <>
                <Play className="size-5" /> Resume
              </>
            )}
          </button>
          <button
            type="button"
            onClick={undoRoom}
            disabled={!started}
            className="flex h-14 flex-col items-center justify-center rounded-xl bg-white/10 text-sm disabled:opacity-40"
          >
            <Undo2 className="size-5" /> {rooms.length ? "Undo room" : "Restart"}
          </button>
          <button
            type="button"
            onClick={() => setCalib({ steps: 0, on: false, dist: "" })}
            disabled={running}
            className="flex h-14 flex-col items-center justify-center rounded-xl bg-white/10 text-sm disabled:opacity-40"
          >
            <Ruler className="size-5" /> Stride
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={!started}
            className="h-14 rounded-xl bg-[#2f7d4a] text-base font-bold disabled:opacity-40"
          >
            Finish
          </button>
        </div>
        <p className="text-center text-sm text-white/60">
          Pause before you stop to look around. Everything can be fixed by hand after Finish.
        </p>
      </div>
    </div>
  );
}
