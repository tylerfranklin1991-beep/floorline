/**
 * Diagram helpers: trace background (per floor), "Auto from sketch" (on-device
 * OCR + line detection → review → rooms) and "Room shape from photos"
 * (tap corners → shape → type every wall length).
 */
import {
  Camera,
  Check,
  Eye,
  EyeOff,
  Images,
  Lock,
  LockOpen,
  Minus,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { jobSettings } from "@/lib/field/job";
import {
  ensureClockwise,
  formatLength,
  newRoom,
  nextRoomOrigin,
  parseLength,
  rectPoints,

  uid,
  type FieldProperty,
  type FieldRoom,
  type Pt,
  type RoomPhoto,
  type TraceImage,
  type Units,
} from "@/lib/field/model";
import { getGeoTag, pickImage, scaleImage } from "@/lib/field/media";
import { recognizeText, isNativeApp } from "@/lib/field/native";
import { prepareFromFile, savePhotoBlob } from "@/lib/field/photos";
import {
  binarize,
  buildProposals,
  findLines,
  type Proposal,
  type SketchResult,
} from "@/lib/field/sketch";
import {
  buildOutline,
  cornerKinds,
  closesLoop,
  cycleTurn,
  turnsFromTaps,
  wallDirections,
  type Tap,
  type Turn,
} from "@/lib/field/roomshape";
import { useBackClose } from "@/lib/field/back";
import { useField } from "@/lib/field/store";
import type { EditorMode } from "./plan-editor";

const FT = (u: Units) => (u === "ft" ? 1 : 0.3048);

/* ------------------------------------------------------------ trace */

function setTrace(levelId: string, t: TraceImage | undefined) {
  useField.getState().change((p) => ({
    ...p,
    levels: p.levels.map((l) => {
      if (l.id !== levelId) return l;
      const { trace: _old, ...rest } = l;
      void _old;
      return t ? { ...rest, trace: t } : rest;
    }),
  }));
}

/** Store an image as the level's trace background. */
export async function importTrace(
  property: FieldProperty,
  levelId: string,
  blob: Blob,
  place?: { x: number; y: number; w: number; calibrated?: boolean },
) {
  const s = await scaleImage(blob, 2000);
  const imageId = uid("trace");
  await savePhotoBlob(imageId, s.blob);
  const u = FT(property.units);
  setTrace(levelId, {
    imageId,
    x: place?.x ?? 0,
    y: place?.y ?? 0,
    w: place?.w ?? 30 * u,
    aspect: s.h / s.w,
    rot: 0,
    opacity: 0.45,
    locked: false,
    hidden: false,
    ...(place?.calibrated ? { calibrated: true } : {}),
  });
}

const center = (t: TraceImage) => {
  const r = (t.rot * Math.PI) / 180;
  const hw = t.w / 2;
  const hh = (t.w * t.aspect) / 2;
  return { x: t.x + hw * Math.cos(r) - hh * Math.sin(r), y: t.y + hw * Math.sin(r) + hh * Math.cos(r) };
};
const fromCenter = (c: Pt, w: number, aspect: number, rot: number) => {
  const r = (rot * Math.PI) / 180;
  const hw = w / 2;
  const hh = (w * aspect) / 2;
  return { x: c.x - (hw * Math.cos(r) - hh * Math.sin(r)), y: c.y - (hw * Math.sin(r) + hh * Math.cos(r)) };
};

/** Bottom panel (over the plan) to import / adjust the current floor's trace image. */
export function TracePanel({
  property,
  levelId,
  mode,
  setMode,
  onClose,
}: {
  property: FieldProperty;
  levelId: string;
  mode: EditorMode;
  setMode: (m: EditorMode) => void;
  onClose: () => void;
}) {
  const t = property.levels.find((l) => l.id === levelId)?.trace;
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<TraceImage>) => t && setTrace(levelId, { ...t, ...p });
  const scale = (k: number) => {
    if (!t) return;
    const c = center(t);
    const w = t.w * k;
    patch({ w, ...fromCenter(c, w, t.aspect, t.rot), calibrated: false });
  };
  const rotate = (d: number) => {
    if (!t) return;
    const c = center(t);
    const rot = (((t.rot + d) % 360) + 360) % 360;
    patch({ rot, ...fromCenter(c, t.w, t.aspect, rot) });
  };
  const load = async (src: "camera" | "gallery") => {
    const b = await pickImage(src);
    if (!b) return;
    setBusy(true);
    try {
      await importTrace(property, levelId, b);
      toast.success("Background added — Move it, then Calibrate");
    } catch {
      toast.error("Couldn't open that image");
    } finally {
      setBusy(false);
    }
  };
  const btn =
    "flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl bg-black/5 text-xs font-semibold disabled:opacity-40";
  const on = "flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl bg-black text-xs font-semibold text-white";
  return (
    <div className="space-y-3 p-4" data-testid="trace-panel">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="text-lg font-bold">Trace background</div>
          <div className="text-sm text-black/55">
            {t
              ? t.calibrated
                ? "Calibrated — drawn walls are real size. Typed lengths always win."
                : "Not calibrated yet: tap Calibrate, then two points you know the distance between."
              : "A hand sketch or photo behind this floor, to draw over."}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close trace panel"
          onClick={onClose}
          className="flex size-12 items-center justify-center rounded-full bg-black/5"
        >
          <X />
        </button>
      </div>
      {!t ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => void load("camera")} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[#b4561d] text-base font-bold text-white">
            <Camera className="size-5" /> Take photo
          </button>
          <button type="button" disabled={busy} onClick={() => void load("gallery")} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold">
            <Images className="size-5" /> From gallery
          </button>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm font-semibold">
            Opacity
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(t.opacity * 100)}
              onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
              className="h-10 flex-1"
              aria-label="Trace opacity"
            />
          </label>
          <div className="grid grid-cols-5 gap-2">
            <button type="button" disabled={t.locked} className={mode === "trace" ? on : btn} onClick={() => setMode(mode === "trace" ? "select" : "trace")}>
              <Move className="size-5" /> Move
            </button>
            <button type="button" disabled={t.locked} className={btn} onClick={() => scale(1 / 1.1)}>
              <Minus className="size-5" /> Smaller
            </button>
            <button type="button" disabled={t.locked} className={btn} onClick={() => scale(1.1)}>
              <Plus className="size-5" /> Bigger
            </button>
            <button type="button" disabled={t.locked} className={btn} onClick={() => rotate(-2)}>
              <RotateCcw className="size-5" /> −2°
            </button>
            <button type="button" disabled={t.locked} className={btn} onClick={() => rotate(2)}>
              <RotateCw className="size-5" /> +2°
            </button>
            <button type="button" disabled={t.locked} className={btn} onClick={() => rotate(90)}>
              <RotateCw className="size-5" /> 90°
            </button>
            <button type="button" disabled={t.locked} className={mode === "calibrate" ? on : btn} onClick={() => setMode(mode === "calibrate" ? "select" : "calibrate")}>
              <Ruler className="size-5" /> Calibrate
            </button>
            <button type="button" className={t.locked ? on : btn} onClick={() => (patch({ locked: !t.locked }), setMode("select"))}>
              {t.locked ? <Lock className="size-5" /> : <LockOpen className="size-5" />} {t.locked ? "Locked" : "Lock"}
            </button>
            <button type="button" className={btn} onClick={() => patch({ hidden: !t.hidden })}>
              {t.hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />} {t.hidden ? "Show" : "Hide"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setTrace(levelId, undefined);
                setMode("select");
                toast("Background removed", {
                  action: { label: "Undo", onClick: () => useField.getState().undo() },
                });
              }}
            >
              <Trash2 className="size-5" /> Remove
            </button>
          </div>
          <p className="text-xs text-black/50">
            Use the toolbar’s Draw to trace rooms on top, then tap wall lengths to type exact measurements.
          </p>
        </>
      )}
    </div>
  );
}

/** After two calibration taps: type the real distance; the image is scaled about the first point. */
export function CalibrateSheet({
  property,
  levelId,
  a,
  b,
  onClose,
}: {
  property: FieldProperty;
  levelId: string;
  a: Pt;
  b: Pt;
  onClose: () => void;
}) {
  useBackClose(true, onClose);
  const [v, setV] = useState("");
  const u = property.units;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const real = parseLength(v, u);
  const apply = () => {
    const t = property.levels.find((l) => l.id === levelId)?.trace;
    if (!t || !real || d <= 0) return;
    const k = real / d;
    setTrace(levelId, {
      ...t,
      x: a.x + (t.x - a.x) * k,
      y: a.y + (t.y - a.y) * k,
      w: t.w * k,
      calibrated: true,
    });
    toast.success(`Calibrated: those points are now ${formatLength(real, u)} apart`);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-xl space-y-3 rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold">Real distance?</h2>
        <p className="text-base text-black/60">
          How far apart are the two points you tapped? (now {formatLength(d, u)} on the plan)
        </p>
        <input
          autoFocus
          inputMode="decimal"
          aria-label="Real distance"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          placeholder={u === "ft" ? "12'8\"" : "3.86"}
          className="h-14 w-full rounded-xl border border-black/15 px-4 text-xl"
        />
        <button type="button" disabled={!real} onClick={apply} className="h-14 w-full rounded-xl bg-black text-lg font-bold text-white disabled:opacity-30">
          Set scale
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- auto from sketch */

type Row = Proposal & { on: boolean; wText: string; lText: string };

async function analyzeSketch(blob: Blob) {
  const s = await scaleImage(blob, 1600);
  // Lines on a smaller copy (fast), mapped back to OCR pixels.
  const k = Math.min(1, 700 / Math.max(s.w, s.h));
  const c = document.createElement("canvas");
  c.width = Math.round(s.w * k);
  c.height = Math.round(s.h * k);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(s.img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const gray = new Uint8Array(c.width * c.height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
  const segs = findLines(binarize(gray, c.width, c.height), c.width, c.height).map((sg) => ({
    ...sg,
    at: sg.at / k,
    from: sg.from / k,
    to: sg.to / k,
  }));
  let ocrLines: { text: string; x: number; y: number; w: number; h: number }[] = [];
  let ocrError: string | null = null;
  try {
    const r = await recognizeText(s.blob);
    const f = s.w / (r.width || s.w);
    ocrLines = r.lines.map((l) => ({ text: l.text, x: l.x * f, y: l.y * f, w: l.w * f, h: l.h * f }));
  } catch (e) {
    ocrError = (e as Error).message || "Text reading failed";
  }
  return { s, result: buildProposals(ocrLines, segs, s.w), ocrError, ocrCount: ocrLines.length };
}

/** Pick a sketch photo, read it, and review the proposed rooms before adding. */
export function SketchImport({
  property,
  levelId,
  onClose,
  onTraceInstead,
}: {
  property: FieldProperty;
  levelId: string;
  onClose: () => void;
  /** Sketch was set as the trace background; open the trace tools. */
  onTraceInstead: () => void;
}) {
  useBackClose(true, onClose);
  const u = property.units;
  const [busy, setBusy] = useState<string | null>(null);
  const [img, setImg] = useState<{ url: string; w: number; h: number; blob: Blob } | null>(null);
  const [res, setRes] = useState<SketchResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [keepTrace, setKeepTrace] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const traceFallback = async (blob: Blob, why: string) => {
    await importTrace(property, levelId, blob);
    toast(why);
    onClose();
    onTraceInstead();
  };

  const start = async (src: "camera" | "gallery") => {
    const b = await pickImage(src);
    if (!b) return;
    setBusy("Reading the sketch…");
    try {
      const { s, result, ocrError, ocrCount } = await analyzeSketch(b);
      if (ocrError && !isNativeApp()) {
        return await traceFallback(s.blob, "Reading sketches needs the Android app — set as a trace background instead.");
      }
      if (result.proposals.length === 0) {
        return await traceFallback(
          s.blob,
          ocrCount
            ? "Couldn't find room sizes or names — trace over the sketch instead."
            : "Couldn't read any writing — trace over the sketch instead.",
        );
      }
      setImg({ url: URL.createObjectURL(s.blob), w: s.w, h: s.h, blob: s.blob });
      setRes(result);
      setRows(
        result.proposals.map((p) => ({
          ...p,
          on: true,
          wText: p.w ? formatLength(p.w * FT(u), u) : "",
          lText: p.l ? formatLength(p.l * FT(u), u) : "",
        })),
      );
      setNote(
        result.quality === "good"
          ? "Check each room, then add them."
          : result.quality === "partial"
            ? "Some rooms are guesses (dashed). Check sizes and names."
            : "Couldn't read sizes. Names are filled in — type the sizes, or trace by hand.",
      );
    } catch {
      toast.error("Couldn't open that image");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!res || !img) return;
    const k = FT(u);
    const st = useField.getState();
    const p0 = st.history?.present;
    if (!p0) return;
    const origin = nextRoomOrigin(p0.rooms.filter((r) => r.levelId === levelId));
    const material = jobSettings(p0.job).defaultMaterial;
    const rooms: FieldRoom[] = [];
    for (const r of rows) {
      if (!r.on) continue;
      const w = parseLength(r.wText, u);
      const l = parseLength(r.lText, u);
      if (!w || !l) continue;
      rooms.push({
        ...newRoom(r.name || "Room", rectPoints(origin.x + r.x * k, origin.y + r.y * k, w, l), "typed"),
        levelId,
        flooring: { material },
      });
    }
    if (!rooms.length) return toast.error("No rooms with both sizes filled in");
    if (keepTrace) {
      await importTrace(property, levelId, img.blob, {
        x: origin.x - res.offset.x * k,
        y: origin.y - res.offset.y * k,
        w: img.w * res.ftPerPx * k,
      });
    }
    st.change((p) => ({ ...p, rooms: [...p.rooms, ...rooms] }));
    st.select(rooms[0].id);
    toast.success(`${rooms.length} room${rooms.length > 1 ? "s" : ""} added — tap any wall length to correct it`, {
      action: { label: "Undo", onClick: () => useField.getState().undo() },
    });
    onClose();
  };

  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const box = "h-12 min-w-0 rounded-xl border border-black/15 bg-white px-2 text-lg";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f2e8]" data-testid="sketch-import">
      <header className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <h1 className="flex-1 text-xl font-bold">{res ? "Review rooms" : "Auto from sketch"}</h1>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-black/5">
          <X />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!res ? (
          <div className="space-y-4">
            <p className="text-base text-black/70">
              Snap a photo of your hand sketch: box rooms with sizes like <b>12'8 x 13'9</b> and names like <b>M.B.R.</b> or <b>closet</b>. It's read on the phone — nothing is uploaded. You review everything before it's added.
            </p>
            <p className="text-sm text-black/50">Tips: flat on a table, good light, dark pen, whole page in frame.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={Boolean(busy)} onClick={() => void start("camera")} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-lg font-bold text-white disabled:opacity-50">
                <Camera /> Take photo
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void start("gallery")} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-black/5 text-lg font-semibold disabled:opacity-50">
                <Images /> Gallery
              </button>
            </div>
            {busy && <p className="text-center text-lg">{busy}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {note && <p className="rounded-xl bg-[#fff8ec] p-3 text-base">{note}</p>}
            {img && (
              <div className="relative overflow-hidden rounded-xl border border-black/10 bg-white">
                <img src={img.url} alt="Sketch" className="block w-full" />
                <svg viewBox={`0 0 ${img.w} ${img.h}`} className="absolute inset-0 h-full w-full">
                  {rows.map((r, i) => (
                    <g key={i} opacity={r.on ? 1 : 0.3}>
                      <rect x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} fill="#b4561d22" stroke="#b4561d" strokeWidth={img.w / 200} strokeDasharray={r.fromBox ? undefined : `${img.w / 60} ${img.w / 90}`} />
                      <circle cx={r.box.x + img.w / 40} cy={r.box.y + img.w / 40} r={img.w / 40} fill="#b4561d" />
                      <text x={r.box.x + img.w / 40} y={r.box.y + img.w / 40 + img.w / 110} fontSize={img.w / 32} textAnchor="middle" fill="#fff" fontWeight={800}>
                        {i + 1}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            )}
            {rows.map((r, i) => (
              <div key={i} className={`space-y-2 rounded-2xl bg-white p-3 shadow-sm ${r.on ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#b4561d] font-bold text-white">{i + 1}</span>
                  <input aria-label={`Room ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className={`${box} flex-1 font-semibold`} />
                  <button type="button" aria-label={r.on ? "Skip this room" : "Include this room"} onClick={() => set(i, { on: !r.on })} className={`flex size-12 shrink-0 items-center justify-center rounded-full ${r.on ? "bg-black text-white" : "bg-black/10"}`}>
                    {r.on ? <Check /> : <X />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input aria-label={`Room ${i + 1} width`} inputMode="decimal" value={r.wText} placeholder="width" onChange={(e) => set(i, { wText: e.target.value })} className={`${box} flex-1`} />
                  <span className="text-xl">×</span>
                  <input aria-label={`Room ${i + 1} length`} inputMode="decimal" value={r.lText} placeholder="length" onChange={(e) => set(i, { lText: e.target.value })} className={`${box} flex-1`} />
                </div>
                <div className="text-xs text-black/50">
                  {r.dimText ? `Read “${r.dimText}”` : "No size found"} · {r.fromBox ? "box found" : "position guessed"} · at {formatLength(r.x * FT(u), u)}, {formatLength(r.y * FT(u), u)}
                </div>
              </div>
            ))}
            {res.leftover.length > 0 && (
              <p className="text-xs text-black/50">Other text seen: {res.leftover.slice(0, 12).join(" · ")}</p>
            )}
            <label className="flex min-h-12 items-center gap-3 text-base">
              <input type="checkbox" className="size-6" checked={keepTrace} onChange={(e) => setKeepTrace(e.target.checked)} />
              Keep the sketch behind the plan (trace background)
            </label>
          </div>
        )}
      </div>
      {res && (
        <footer className="grid grid-cols-2 gap-2 border-t border-black/10 bg-white p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            onClick={() => img && void traceFallback(img.blob, "Sketch set as background — use Draw to trace rooms")}
            className="h-14 rounded-xl bg-black/5 text-base font-semibold"
          >
            Trace by hand
          </button>
          <button type="button" onClick={() => void add()} className="h-14 rounded-xl bg-[#b4561d] text-base font-bold text-white">
            Add {rows.filter((r) => r.on && parseLength(r.wText, u) && parseLength(r.lText, u)).length} rooms
          </button>
        </footer>
      )}
    </div>
  );
}

/* ------------------------------------------------ room shape from photos */

type Shot = { blob: Blob; url: string; w: number; h: number };

/** Preview outline with typed lengths where known, tapped proportions otherwise. */
function previewPoints(turns: Turn[], lengths: (number | null)[], fallback: number[]): Pt[] {
  const dirs = wallDirections(turns);
  const pts: Pt[] = [];
  let p = { x: 0, y: 0 };
  dirs.forEach((d, i) => {
    pts.push(p);
    const L = lengths[i] ?? fallback[i] ?? 1;
    p = { x: p.x + d.x * L, y: p.y + d.y * L };
  });
  return pts;
}

function ShapeSketch({ pts, hi, labels }: { pts: Pt[]; hi: number | null; labels?: string[] }) {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const W = Math.max(...xs) - minX || 1;
  const H = Math.max(...ys) - minY || 1;
  const pad = Math.max(W, H) * 0.15;
  const sw = Math.max(W, H) / 60;
  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${W + pad * 2} ${H + pad * 2}`} className="h-44 w-full rounded-xl bg-white">
      <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="#efe2c6" stroke="#1c1b18" strokeWidth={sw} />
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return (
          <g key={i}>
            {hi === i && <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#b4561d" strokeWidth={sw * 4} strokeLinecap="round" />}
            <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2} fontSize={sw * 5} textAnchor="middle" fill={hi === i ? "#b4561d" : "#5c574d"} fontWeight={700} stroke="#fff" strokeWidth={sw} paintOrder="stroke">
              {labels?.[i] ?? i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PhotoShape({
  property,
  defaultName,
  onClose,
  onDone,
}: {
  property: FieldProperty;
  defaultName: string;
  onClose: () => void;
  onDone: (name: string, points: Pt[], photos: RoomPhoto[]) => void;
}) {
  useBackClose(true, onClose);
  const u = property.units;
  const [name, setName] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [cur, setCur] = useState(0);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [step, setStep] = useState<"corners" | "shape" | "measure">("corners");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [wall, setWall] = useState(0);
  const [texts, setTexts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const addShot = async (src: "camera" | "gallery") => {
    const b = await pickImage(src);
    if (!b) return;
    try {
      const s = await scaleImage(b, 1600);
      setShots((xs) => [...xs, { blob: s.blob, url: URL.createObjectURL(s.blob), w: s.w, h: s.h }]);
      setCur(shots.length);
    } catch {
      toast.error("Couldn't open that photo");
    }
  };

  const lengths = texts.map((t) => parseLength(t, u));
  // Tapped wall lengths (pixels) as a rough preview only — never used for sizes.
  const pxLens = useMemo(
    () =>
      taps.map((a, i) => {
        const b = taps[(i + 1) % taps.length];
        return a.photo === b.photo ? Math.hypot(b.x - a.x, b.y - a.y) * 20 : 10;
      }),
    [taps],
  );
  const outline = turns.length ? buildOutline(turns, lengths) : null;
  const typed = lengths.map((x) => (x ? formatLength(x, u) : ""));

  const tapAt = (e: React.MouseEvent) => {
    const el = imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTaps((t) => [...t, { photo: cur, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }]);
  };

  const finish = async () => {
    if (!outline) return toast.error("Type more wall lengths (at most the last two can be left blank)");
    if (outline.gap > (u === "ft" ? 0.25 : 0.08))
      toast(`Walls don't close by ${formatLength(outline.gap, u)} — check a length; closed it anyway`);
    setBusy(true);
    const geo = await getGeoTag();
    const photos: RoomPhoto[] = [];
    for (const s of shots.slice(0, 12)) {
      const prepared = await prepareFromFile(s.blob);
      const id = uid("photo");
      await savePhotoBlob(id, prepared.full).catch(() => {});
      photos.push({ id, kind: "photo", thumb: prepared.thumb, takenAt: Date.now(), ...(geo ? { geo } : {}) });
    }
    setBusy(false);
    onDone(name.trim() || defaultName, ensureClockwise(outline.points), photos);
  };

  const shot = shots[cur];
  const curTaps = taps.map((t, i) => ({ ...t, i })).filter((t) => t.photo === cur);
  const wallTaps = step === "measure" && taps.length ? [taps[wall], taps[(wall + 1) % taps.length]] : null;
  const kinds = cornerKinds(turns);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f2e8]" data-testid="photo-shape">
      <header className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <h1 className="flex-1 text-xl font-bold">
          {step === "corners" ? "Tap the floor corners" : step === "shape" ? "Check the shape" : `Wall ${wall + 1} of ${turns.length}`}
        </h1>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-black/5">
          <X />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {step === "corners" && (
          <>
            <input aria-label="Room name" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} className="h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-lg" />
            {!shot ? (
              <p className="text-base text-black/70">
                Take 1 or more photos with the floor corners visible (a corner of the room, or from a doorway). Then tap each floor corner <b>in order</b> going around the room. The photo gives the <b>shape and number of walls</b> only — you type every measurement.
              </p>
            ) : (
              <div className="relative select-none" onClick={tapAt}>
                <img ref={imgRef} src={shot.url} alt="Room" className="block w-full rounded-xl" draggable={false} />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  {curTaps.map((t, k) => {
                    const nxt = taps[(t.i + 1) % taps.length];
                    return nxt && nxt.photo === cur && (k < curTaps.length - 1 || taps.length > 2) && t.i !== taps.length - 1 ? (
                      <line key={`l${t.i}`} x1={t.x} y1={t.y} x2={nxt.x} y2={nxt.y} stroke="#b4561d" strokeWidth={0.006} />
                    ) : null;
                  })}
                </svg>
                {curTaps.map((t) => (
                  <span key={t.i} className="pointer-events-none absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#b4561d] text-sm font-bold text-white" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
                    {t.i + 1}
                  </span>
                ))}
              </div>
            )}
            {shots.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {shots.map((s, i) => (
                  <button key={i} type="button" onClick={() => setCur(i)} className={`shrink-0 overflow-hidden rounded-lg border-4 ${i === cur ? "border-[#b4561d]" : "border-transparent"}`}>
                    <img src={s.url} alt={`Photo ${i + 1}`} className="h-16 w-20 object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void addShot("camera")} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold">
                <Camera className="size-5" /> {shots.length ? "Another photo" : "Take photo"}
              </button>
              <button type="button" onClick={() => void addShot("gallery")} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold">
                <Images className="size-5" /> Gallery
              </button>
            </div>
            {shot && (
              <p className="text-sm text-black/60">
                {taps.length} corner{taps.length === 1 ? "" : "s"} tapped. Corners hidden in this photo? Switch photo and keep tapping in order.
              </p>
            )}
          </>
        )}

        {step !== "corners" && (
          <>
            {step === "measure" && wallTaps && shots[wallTaps[0].photo] && (
              <div className="relative">
                <img src={shots[wallTaps[0].photo].url} alt="Room" className="block max-h-[34dvh] w-full rounded-xl object-contain" />
                {wallTaps[0].photo === wallTaps[1].photo && (
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <line x1={wallTaps[0].x} y1={wallTaps[0].y} x2={wallTaps[1].x} y2={wallTaps[1].y} stroke="#b4561d" strokeWidth={0.012} strokeLinecap="round" />
                  </svg>
                )}
              </div>
            )}
            <ShapeSketch
              pts={previewPoints(turns, step === "measure" ? lengths : [], pxLens)}
              hi={step === "measure" ? wall : null}
              labels={step === "measure" ? typed.map((t, i) => t || String(i + 1)) : undefined}
            />
            {step === "shape" && (
              <>
                <p className="text-base">
                  <b>{turns.length} walls</b>, {kinds.filter((k) => k === "inside").length} inside corner(s). Tap a corner to fix it:
                </p>
                <div className="flex flex-wrap gap-2">
                  {turns.map((t, i) => (
                    <button key={i} type="button" onClick={() => setTurns((ts) => ts.map((x, j) => (j === i ? cycleTurn(x) : x)))} className="h-12 rounded-full bg-black/5 px-4 text-sm font-semibold">
                      after wall {i + 1}: {kinds[i]} {Math.abs(t)}°
                    </button>
                  ))}
                </div>
                {!closesLoop(turns) && (
                  <p className="text-sm text-red-800">These corners don't make a closed room — flip one.</p>
                )}
              </>
            )}
            {step === "measure" && (
              <div className="space-y-2">
                <input
                  key={wall}
                  autoFocus
                  aria-label={`Wall ${wall + 1} length`}
                  inputMode="decimal"
                  value={texts[wall] ?? ""}
                  onChange={(e) => setTexts((ts) => ts.map((x, j) => (j === wall ? e.target.value : x)))}
                  onKeyDown={(e) => e.key === "Enter" && wall < turns.length - 1 && setWall(wall + 1)}
                  placeholder={wall >= turns.length - 2 ? "measure, or leave blank to auto-close" : u === "ft" ? "12'8\"" : "3.86"}
                  className="h-16 w-full rounded-xl border-2 border-[#b4561d] bg-white px-4 text-2xl"
                />
                {outline && (
                  <p className="text-sm text-black/60">
                    {outline.solved.length
                      ? `Auto-closed: ${outline.solved.map((i) => `wall ${i + 1} = ${formatLength(outline.lengths[i], u)}`).join(", ")}. `
                      : ""}
                    {outline.gap > 0.01 ? `Gap ${formatLength(outline.gap, u)} — check lengths.` : "Shape closes."}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-black/10 bg-white p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {step === "corners" ? (
          <>
            <button type="button" disabled={!taps.length} onClick={() => setTaps((t) => t.slice(0, -1))} className="h-14 rounded-xl bg-black/5 text-base font-semibold disabled:opacity-40">
              Undo corner
            </button>
            <button
              type="button"
              disabled={taps.length < 3}
              onClick={() => {
                const t = turnsFromTaps(taps);
                setTurns(t);
                setTexts(t.map(() => ""));
                setWall(0);
                setStep("shape");
              }}
              className="h-14 rounded-xl bg-[#b4561d] text-base font-bold text-white disabled:opacity-40"
            >
              Done ({taps.length})
            </button>
          </>
        ) : step === "shape" ? (
          <>
            <button type="button" onClick={() => setStep("corners")} className="h-14 rounded-xl bg-black/5 text-base font-semibold">
              Back to corners
            </button>
            <button type="button" disabled={!closesLoop(turns)} onClick={() => setStep("measure")} className="h-14 rounded-xl bg-[#b4561d] text-base font-bold text-white disabled:opacity-40">
              Measure walls
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => (wall > 0 ? setWall(wall - 1) : setStep("shape"))} className="h-14 rounded-xl bg-black/5 text-base font-semibold">
              ← Back
            </button>
            {wall < turns.length - 1 ? (
              <button type="button" onClick={() => setWall(wall + 1)} className="h-14 rounded-xl bg-black text-base font-bold text-white">
                Next wall →
              </button>
            ) : (
              <button type="button" disabled={busy || !outline} onClick={() => void finish()} className="h-14 rounded-xl bg-[#b4561d] text-base font-bold text-white disabled:opacity-40">
                {busy ? "Saving…" : "Create room"}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

