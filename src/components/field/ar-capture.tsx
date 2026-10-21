import { useEffect, useRef, useState } from "react";
import { arPointsToPlan, startArSession, type ArPoint, type ArSessionHandle } from "@/lib/field/ar";
import { formatLength, type Pt, type Units } from "@/lib/field/model";
import { OutlinePreview } from "./outline-preview";

/**
 * AR corner capture (Android Chrome + Google Play Services for AR).
 * User aims the crosshair at the floor in each corner and taps "Mark corner".
 */
export function ArCapture({
  units,
  onDone,
  onCancel,
}: {
  units: Units;
  onDone: (rawPlanPoints: Pt[]) => void;
  onCancel: (reason?: string) => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const session = useRef<ArSessionHandle | null>(null);
  const [running, setRunning] = useState(false);
  const [hit, setHit] = useState<ArPoint | null>(null);
  const [corners, setCorners] = useState<ArPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cornersRef = useRef<ArPoint[]>([]);
  const finishing = useRef(false);
  cornersRef.current = corners;

  useEffect(() => () => session.current?.end(), []);

  const start = async () => {
    setError(null);
    try {
      session.current = await startArSession({
        overlay: overlay.current!,
        onHit: (p) => setHit(p),
        onEnd: () => {
          setRunning(false);
          session.current = null;
          if (!finishing.current) onCancel();
        },
      });
      setRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        `AR couldn't start (${msg}). Make sure "Google Play Services for AR" is installed and camera permission is allowed — or use Camera walk instead.`,
      );
    }
  };

  const mark = () => {
    const p = session.current?.current();
    if (!p) return;
    navigator.vibrate?.(30);
    setCorners((c) => [...c, p]);
  };

  const finish = () => {
    finishing.current = true;
    const pts = arPointsToPlan(cornersRef.current, units);
    session.current?.end();
    onDone(pts);
  };

  const last = corners[corners.length - 1];
  const live =
    last && hit
      ? Math.hypot(hit.x - last.x, hit.z - last.z) * (units === "ft" ? 1 / 0.3048 : 1)
      : null;
  const preview = arPointsToPlan(hit && running ? [...corners, hit] : corners, units);

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      <div
        ref={overlay}
        className="absolute inset-0"
        style={{ background: running ? "transparent" : "#111" }}
      >
        {!running && (
          <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-5 p-6">
            <h2 className="text-2xl font-bold">AR corner capture</h2>
            <ol className="list-decimal space-y-2 pl-5 text-lg leading-snug">
              <li>Stand in the middle of the room.</li>
              <li>Slowly sweep the phone over the floor until the crosshair turns green.</li>
              <li>
                Aim at the floor right in each corner, going around the room in order, and tap{" "}
                <b>Mark corner</b>.
              </li>
              <li>
                Tap <b>Finish</b> — we square up the walls for you.
              </li>
            </ol>
            {error && <p className="rounded-lg bg-red-900/60 p-3 text-base">{error}</p>}
            <button
              type="button"
              onClick={start}
              className="h-16 rounded-2xl bg-[#e07a35] text-xl font-bold"
            >
              Start AR
            </button>
            <button
              type="button"
              onClick={() => onCancel(error ?? undefined)}
              className="h-14 rounded-2xl bg-white/10 text-lg"
            >
              Back
            </button>
          </div>
        )}
        {running && (
          <>
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div
                className={`size-16 rounded-full border-4 ${hit ? "border-[#7fe08a]" : "border-white/60"}`}
              />
              <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            </div>
            <div
              className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4"
              style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
            >
              <div className="rounded-xl bg-black/70 px-4 py-3 text-lg font-semibold">
                {hit
                  ? `Corner ${corners.length + 1}: aim at the corner on the floor`
                  : "Sweep the phone over the floor…"}
                {live != null && (
                  <div className="text-base font-normal text-[#ffd29a]">
                    Wall so far ≈ {formatLength(live, units)}
                  </div>
                )}
              </div>
              <OutlinePreview points={preview} closed={corners.length >= 3} size={110} />
            </div>
            <div
              className="absolute inset-x-0 bottom-0 grid grid-cols-3 gap-3 p-4"
              style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            >
              <button
                type="button"
                onClick={() => setCorners((c) => c.slice(0, -1))}
                disabled={!corners.length}
                className="h-16 rounded-2xl bg-black/70 text-lg disabled:opacity-40"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={mark}
                disabled={!hit}
                className="h-16 rounded-2xl bg-[#e07a35] text-lg font-bold disabled:opacity-40"
              >
                Mark corner
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={corners.length < 3}
                className="h-16 rounded-2xl bg-[#2f7d4a] text-lg font-bold disabled:opacity-40"
              >
                Finish ({corners.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
