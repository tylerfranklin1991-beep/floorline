import { Camera, CornerUpLeft, CornerUpRight, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { useCamera } from "@/lib/field/use-camera";
import {
  formatLength,
  MAX_PHOTOS_PER_ROOM,
  outlineFromWalk,
  parseLength,
  type Pt,
  type Units,
  type WalkStep,
} from "@/lib/field/model";
import { prepareFromSource, type PreparedPhoto } from "@/lib/field/photos";
import { OutlinePreview } from "./outline-preview";

/**
 * Guided camera walk: works on any phone with a camera (no AR needed).
 * Stand in a corner, face along a wall, then for each wall tap which way you
 * turn at the next corner. Length is optional (type it, or keep the estimate)
 * and can be fixed later. The outline is squared up automatically.
 */
export function WalkCapture({
  units,
  onDone,
  onCancel,
}: {
  units: Units;
  onDone: (points: Pt[], photos: PreparedPhoto[], measured: boolean) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const cam = useCamera(video, true);
  const camReady = cam.status === "live";
  const [steps, setSteps] = useState<WalkStep[]>([]);
  const [lengthText, setLengthText] = useState("");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [typedAny, setTypedAny] = useState(false);
  const defaultLen = units === "ft" ? 10 : 3;

  const typed = parseLength(lengthText, units);
  const addWall = (turn: "left" | "right") => {
    navigator.vibrate?.(25);
    if (typed != null) setTypedAny(true);
    setSteps((s) => [...s, { length: typed ?? defaultLen, turn }]);
    setLengthText("");
  };

  const snapPhoto = async () => {
    if (!video.current || photos.length >= MAX_PHOTOS_PER_ROOM) return;
    try {
      const p = await prepareFromSource(video.current);
      setPhotos((x) => [...x, p]);
      navigator.vibrate?.(40);
    } catch {
      /* camera not ready */
    }
  };

  const path: Pt[] = (() => {
    let dir = 0;
    let p = { x: 0, y: 0 };
    const out = [p];
    for (const s of steps) {
      p = {
        x: p.x + (dir === 0 ? s.length : dir === 2 ? -s.length : 0),
        y: p.y + (dir === 1 ? s.length : dir === 3 ? -s.length : 0),
      };
      out.push(p);
      dir = (dir + (s.turn === "right" ? 1 : 3)) % 4;
    }
    return out;
  })();

  const finish = () => {
    cam.stop();
    onDone(outlineFromWalk(steps, units === "ft" ? 0.5 : 0.1), photos, typedAny);
  };

  const wallNo = steps.length + 1;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video
        ref={video}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
      {!camReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center text-lg text-white/80">
          <p>
            {cam.status === "error"
              ? cam.error
              : cam.status === "starting"
                ? "Starting camera… allow camera access if asked."
                : "Camera is off."}
          </p>
          {cam.status !== "starting" && (
            <button
              type="button"
              onClick={() => void cam.start()}
              className="h-14 rounded-xl bg-[#b4561d] px-6 text-lg font-bold text-white"
            >
              Tap to start camera
            </button>
          )}
          <p className="text-sm text-white/60">You can still tap the turns without the camera.</p>
        </div>
      )}
      <div
        className="relative flex items-start justify-between gap-3 p-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <div className="max-w-[65%] rounded-xl bg-black/70 px-4 py-3">
          <div className="text-sm uppercase tracking-wide text-[#ffd29a]">Wall {wallNo}</div>
          <div className="text-lg font-semibold leading-snug">
            {steps.length === 0
              ? "Stand in a corner and face along a wall. Walk (or look) to the next corner."
              : "At the next corner, which way does the wall turn?"}
          </div>
        </div>
        <OutlinePreview points={path} closed={false} size={110} />
      </div>
      <div
        className="relative mt-auto space-y-3 bg-gradient-to-t from-black via-black/85 to-transparent p-4 pt-10"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <label className="flex items-center gap-3">
          <span className="text-base">Length (optional)</span>
          <input
            inputMode="decimal"
            value={lengthText}
            onChange={(e) => setLengthText(e.target.value)}
            placeholder={`≈ ${formatLength(defaultLen, units)}`}
            className="h-14 min-w-0 flex-1 rounded-xl bg-white/15 px-4 text-xl text-white placeholder:text-white/50"
            aria-label="Wall length"
          />
        </label>
        {lengthText && typed == null && (
          <p className="text-sm text-red-300">Try 12, 12.5 or 12'6"</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => addWall("left")}
            className="flex h-20 items-center justify-center gap-2 rounded-2xl bg-white/15 text-xl font-bold"
          >
            <CornerUpLeft className="size-7" /> Turns left
          </button>
          <button
            type="button"
            onClick={() => addWall("right")}
            className="flex h-20 items-center justify-center gap-2 rounded-2xl bg-white/15 text-xl font-bold"
          >
            Turns right <CornerUpRight className="size-7" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-14 rounded-xl bg-white/10 text-base"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setSteps((s) => s.slice(0, -1))}
            disabled={!steps.length}
            className="flex h-14 items-center justify-center rounded-xl bg-white/10 disabled:opacity-40"
            aria-label="Undo last wall"
          >
            <Undo2 />
          </button>
          <button
            type="button"
            onClick={snapPhoto}
            disabled={!camReady || photos.length >= MAX_PHOTOS_PER_ROOM}
            className="flex h-14 items-center justify-center gap-1 rounded-xl bg-white/10 text-base disabled:opacity-40"
          >
            <Camera className="size-5" /> {photos.length}/{MAX_PHOTOS_PER_ROOM}
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={steps.length < 3}
            className="h-14 rounded-xl bg-[#2f7d4a] text-base font-bold disabled:opacity-40"
          >
            Finish
          </button>
        </div>
        <p className="text-center text-sm text-white/60">
          After 3 walls you can Finish — we close and square the room.
        </p>
      </div>
    </div>
  );
}
