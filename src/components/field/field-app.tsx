import {
  ArrowLeft,
  Download,
  FileJson,
  FileText,
  Grid2x2Plus,
  Image as ImageIcon,
  Plus,
  Redo2,
  ScanLine,
  Share2,
  Trash2,
  Undo2,
  Upload,
  Footprints,
  Ruler,
  ChartNoAxesColumnIncreasing as StairsIcon,
  Pencil,
  Settings2,
  DoorOpen,
  Layers,
  PanelTop,
  RectangleVertical,
  MapPin,
  Camera,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isArSupported } from "@/lib/field/ar";
import { exportJson, exportPng, printPdf, sharePng } from "@/lib/field/export";
import {
  area,
  bbox,
  edges,
  formatArea,
  formatLength,
  gridStep,
  levelView,
  nearestWall,
  nextLevelName,
  nextRoomOrigin,
  newRoom,
  parseLength,
  polygonsOverlap,
  rectilinearize,
  rectPoints,
  closureGap,
  ensureClockwise,
  lShapePoints,
  ROOM_PRESETS,
  setWallLength,
  wallSnapInches,
  setWallSnapInches,
  translate,
  uid,
  type FieldOpening,
  type FieldProperty,
  type FieldRoom,
  type Pt,
  type Units,
  MAX_PHOTOS_PER_ROOM,
} from "@/lib/field/model";
import { loadPhotoBlob, savePhotoBlob, type PreparedPhoto } from "@/lib/field/photos";
import { setOnSaveError, useCurrentProperty, useField } from "@/lib/field/store";
import { ArCapture } from "./ar-capture";
import { CalibrateSheet, PhotoShape, SketchImport, TracePanel } from "./sketch-tools";
import { installBackHandler, useBackClose } from "@/lib/field/back";
import { formatGeo, mapsUrl } from "@/lib/field/media";
import { MaterialsScreen } from "./materials-screen";
import { QuoteSheet } from "./quote-sheet";
import { SeamDock } from "./seam-dock";
import { JobSettingsSheet } from "./job-settings";
import { sharePdf } from "@/lib/field/pdf";
import { areaSummary } from "@/lib/field/materials";
import { PlanEditor, type EditorMode } from "./plan-editor";
import { RoomPanel, LengthInput, SquareUpButton } from "./room-panel";
import { StairsPanel } from "./stairs-panel";
import { WalkCapture } from "./walk-capture";
import { WalkMode, type WalkRoom } from "./walk-mode";
import { ArrowSheet, LaserButton, LaserReadout, LaserSheet, type PlanDraft } from "./laser-controls";
import { HelpButton, HelpMark, TutorialHost, WelcomeTip } from "./tutorials-ui";
import { dismissWelcome, welcomePending } from "@/lib/field/tutorials";
import { advanceLaserTarget } from "@/lib/field/arrow-draw";
import { autoReconnect, onDistoReading, useDisto } from "@/lib/field/disto-link";
import { metersToPlan } from "@/lib/field/disto-protocol";

let lastSaveToast = 0;
setOnSaveError(() => {
  if (Date.now() - lastSaveToast < 15_000) return;
  lastSaveToast = Date.now();
  toast.error(
    "Phone storage is full — your latest change may not be saved. Remove some photos or export a backup.",
  );
});

export function FieldApp() {
  const property = useCurrentProperty();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    installBackHandler(() => {
      const st = useField.getState();
      if (st.currentId) {
        st.openProperty(null);
        return true;
      }
      return false;
    });
  }, []);
  useEffect(() => {
    if (useField.persist.hasHydrated()) setHydrated(true);
    return useField.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  if (!hydrated)
    return <div className="flex h-dvh items-center justify-center text-lg">Loading…</div>;
  return property ? <PropertyScreen property={property} /> : <HomeScreen />;
}

/* ---------------------------------------------------------------- home */

function HomeScreen() {
  const properties = useField((s) => s.properties);
  const createProperty = useField((s) => s.createProperty);
  const openProperty = useField((s) => s.openProperty);
  const deleteProperty = useField((s) => s.deleteProperty);
  const importProperty = useField((s) => s.importProperty);
  const [name, setName] = useState("");
  const [units, setUnits] = useState<Units>("ft");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="mx-auto min-h-dvh max-w-xl space-y-6 p-5"
      style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
    >
      <header>
        <h1 className="text-3xl font-bold">Floorline</h1>
        <p className="text-lg text-black/60">
          Walk a property, get a clean floor plan you can measure.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-xl font-bold">New property</h2>
        <input
          aria-label="Property name or address"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 412 Elm St"
          className="h-14 w-full rounded-xl border border-black/15 px-4 text-xl"
        />
        <div className="flex gap-2" role="radiogroup" aria-label="Units">
          {(["ft", "m"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={units === u}
              onClick={() => setUnits(u)}
              className={`h-12 flex-1 rounded-xl text-lg font-semibold ${units === u ? "bg-black text-white" : "bg-black/5"}`}
            >
              {u === "ft" ? "Feet & inches" : "Metres"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => createProperty(name || `Property ${properties.length + 1}`, units)}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-xl font-bold text-white"
        >
          <Plus /> Start property
        </button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Saved on this phone</h2>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-11 items-center gap-2 rounded-xl bg-black/5 px-3 text-base"
          >
            <Upload className="size-4" /> Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                if (importProperty(JSON.parse(await f.text()))) toast.success("Imported");
                else toast.error("That file isn't a Floorline plan");
              } catch {
                toast.error("That file isn't a Floorline plan");
              }
            }}
          />
        </div>
        {properties.length === 0 && (
          <p className="text-base text-black/50">
            Nothing yet. Plans autosave here and work offline.
          </p>
        )}
        {properties.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm">
            <button
              type="button"
              onClick={() => openProperty(p.id)}
              className="min-h-14 flex-1 px-2 text-left"
            >
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-sm text-black/50">
                {p.rooms.length} room{p.rooms.length === 1 ? "" : "s"} ·{" "}
                {formatArea(
                  p.rooms.reduce((s, r) => s + area(r.points), 0),
                  p.units,
                )}{" "}
                · {new Date(p.updatedAt).toLocaleDateString()}
              </div>
            </button>
            <button
              type="button"
              aria-label={`Delete ${p.name}`}
              onClick={() =>
                window.confirm(`Delete ${p.name}? This can't be undone.`) && deleteProperty(p.id)
              }
              className="flex size-12 items-center justify-center rounded-full"
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ property */

/* ------------------------------------------------------------ property */

function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > 80 ? Math.round(covered) : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Compact room bar. It overlays the plan, so opening it does not resize the canvas. */
function SelectionBar({
  property,
  room,
  stairs,
  open,
  focusWall,
  keyboard,
  onOpenChange,
  children,
}: {
  property: FieldProperty;
  room: FieldRoom | null;
  stairs: FieldProperty["stairs"][number] | null;
  open: boolean;
  focusWall: number | null;
  keyboard: number;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const updateRoom = useField((s) => s.updateRoom);
  const startY = useRef(0);
  const dragged = useRef(false);
  const [snap, setSnap] = useState<0.5 | 1>(() => wallSnapInches());
  const edge = room && focusWall != null ? edges(room.points)[focusWall] : undefined;
  const title = stairs ? "Stairs" : (room?.name ?? "Room");
  const detail = stairs
    ? stairs.steps
      ? `${stairs.steps} steps`
      : ""
    : room
      ? formatArea(area(room.points), property.units)
      : "";
  return (
    <div
      className={`z-30 flex flex-col rounded-t-2xl border border-black/10 bg-[#fbf7ed] shadow-[0_-6px_18px_rgba(0,0,0,0.12)] ${open ? "max-h-[52%]" : ""}`}
      style={
        keyboard > 0
          ? { position: "fixed", left: 8, right: 8, bottom: keyboard + 8 }
          : { position: "absolute", left: 8, right: 8, bottom: 8 }
      }
      role="dialog"
      aria-label={open ? "Room menu" : "Room"}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex min-h-14 items-center gap-1 pr-2">
        <button
          type="button"
          aria-label={open ? "Collapse room menu" : "Expand room menu"}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-1 px-1 text-left"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            dragged.current = false;
          }}
          onPointerMove={(e) => {
            if (Math.abs(e.clientY - startY.current) > 10) dragged.current = true;
          }}
          onPointerUp={(e) => {
            const dy = e.clientY - startY.current;
            if (dy < -28) onOpenChange(true);
            else if (dy > 28) onOpenChange(false);
          }}
          onClick={() => {
            if (dragged.current) return;
            onOpenChange(!open);
          }}
        >
          {open ? <ChevronDown className="size-7 shrink-0" /> : <ChevronUp className="size-7 shrink-0" />}
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold leading-tight">{title}</span>
            {detail && <span className="block text-sm text-black/55">{detail}</span>}
          </span>
        </button>
        {!open && edge && room && (
          <LengthInput
            label={`Wall ${edge.index + 1} length`}
            value={edge.length}
            units={property.units}
            onCommit={(n) => {
              const next = setWallLength(room.points, edge.index, n);
              if (!next) return false;
              updateRoom(room.id, { points: next });
              return true;
            }}
          />
        )}
        {open && (
          <button
            type="button"
            className="h-12 shrink-0 rounded-full bg-black px-4 text-sm font-bold text-white"
            onClick={() => onOpenChange(false)}
          >
            Done
          </button>
        )}
      </div>
      {room && <SquareUpButton room={room} units={property.units} />}
      {room &&
        property.rooms.some((other) => other.id !== room.id && polygonsOverlap(room.points, other.points)) && (
          <p className="px-3 pb-2 text-sm font-semibold text-[#8a3b12]">
            This room overlaps another. Square footage may be counted twice.
          </p>
        )}
      {room && edge && (
        <div className="flex items-center gap-2 px-3 pb-2 text-xs font-semibold text-black/60">
          <span>Drag snap</span>
          {([0.5, 1] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={snap === n}
              onClick={() => {
                setWallSnapInches(n);
                setSnap(n);
              }}
              className={`h-9 rounded-full px-3 ${snap === n ? "bg-black text-white" : "bg-black/5"}`}
            >
              {n === 0.5 ? "½\"" : "1\""}
            </button>
          ))}
        </div>
      )}
      {open && <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-black/10">{children}</div>}
    </div>
  );
}

type Capture = null | { kind: "ar" | "walk" | "walkmode"; name: string };

function PropertyScreen({ property: full }: { property: FieldProperty }) {
  const storedLevelId = useField((s) => s.currentLevelId);
  // Undo can remove the level you were on; fall back to the first one.
  const levelId = full.levels.some((l) => l.id === storedLevelId)
    ? storedLevelId!
    : full.levels[0].id;
  const property = levelView(full, levelId);
  const selectedStairsId = useField((s) => s.selectedStairsId);
  const selectStairs = useField((s) => s.selectStairs);
  const stairs = property.stairs.find((x) => x.id === selectedStairsId) ?? null;
  const openProperty = useField((s) => s.openProperty);
  const change = useField((s) => s.change);
  const undo = useField((s) => s.undo);
  const redo = useField((s) => s.redo);
  const canUndo = useField((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = useField((s) => (s.history?.future.length ?? 0) > 0);
  const selectedRoomId = useField((s) => s.selectedRoomId);
  const selectedOpeningId = useField((s) => s.selectedOpeningId);
  const select = useField((s) => s.select);
  const addRoom = useField((s) => s.addRoom);
  const setUnits = useField((s) => s.setUnits);
  const [mode, setMode] = useState<EditorMode>("select");
  const [adding, setAdding] = useState(false);
  const [capture, setCapture] = useState<Capture>(null);
  const [focusWall, setFocusWall] = useState<number | null>(null);
  const [photo, setPhoto] = useState<{ roomId: string; photoId: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showSeams, setShowSeams] = useState(false);
  const [openingPick, setOpeningPick] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const keyboard = useKeyboardInset();
  const [fitNonce, setFitNonce] = useState(0);
  const [drawName, setDrawName] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState<string | null>(null);
  const [cal, setCal] = useState<{ a: Pt; b: Pt } | null>(null);
  const [laserOpen, setLaserOpen] = useState(false);
  const [arrowOn, setArrowOn] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`floorline.draw-draft.${full.id}`);
      const saved = raw ? (JSON.parse(raw) as { points?: unknown[]; roomClosed?: boolean }) : null;
      if (saved?.points && saved.points.length > 1 && !saved.roomClosed) setArrowOn(true);
    } catch {
      /* ignore a bad save */
    }
  }, [full.id]);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [laserNote, setLaserNote] = useState<{ label: string; detail: string; reshoot: boolean } | null>(null);
  const arrowUndoRef = useRef<(() => boolean) | null>(null);
  const arrowReadRef = useRef<((meters: number) => boolean) | null>(null);
  const focusRef = useRef<number | null>(null);
  const levelRef = useRef(levelId);
  const arrowOnRef = useRef(arrowOn);
  const lastShot = useRef<{ roomId: string; wall: number; before: Pt[]; after: Pt[] } | null>(null);
  focusRef.current = focusWall;
  levelRef.current = levelId;
  arrowOnRef.current = arrowOn;
  const disto = useDisto();
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const openHelp = (id?: string) => {
    setHelpTopic(id ?? null);
    setHelpOpen(true);
    setWelcome(false);
  };
  const openHelpRef = useRef(openHelp);
  openHelpRef.current = openHelp;
  useEffect(() => {
    const onHelp = (e: Event) => openHelpRef.current(String((e as CustomEvent<string>).detail));
    const onWelcome = () => setWelcome(true);
    window.addEventListener("floorline-help", onHelp);
    window.addEventListener("floorline-welcome", onWelcome);
    if (welcomePending()) setWelcome(true);
    return () => {
      window.removeEventListener("floorline-help", onHelp);
      window.removeEventListener("floorline-welcome", onWelcome);
    };
  }, []);
  const room = property.rooms.find((r) => r.id === selectedRoomId) ?? null;

  // Android back: close the top-most thing first (registration order = stacking order).
  useBackClose(Boolean(room) && !stairs, () => {
    select(null);
    setFocusWall(null);
  });
  useBackClose(Boolean(stairs), () => selectStairs(null));
  useBackClose(mode !== "select", () => setMode("select"));
  useBackClose(adding, () => setAdding(false));
  useBackClose(openingPick, () => setOpeningPick(false));
  useBackClose(menu, () => setMenu(false));
  useBackClose(Boolean(capture), () => setCapture(null));
  useBackClose(Boolean(photo), () => setPhoto(null));
  useBackClose(traceOpen, () => {
    setTraceOpen(false);
    setMode("select");
  });
  useBackClose(laserOpen, () => setLaserOpen(false));
  useBackClose(arrowOn, () => setArrowOn(false));
  useBackClose(welcome, () => {
    dismissWelcome();
    setWelcome(false);
  });
  useBackClose(helpOpen, () => setHelpOpen(false));

  useEffect(() => {
    void autoReconnect();
  }, []);

  useEffect(() => {
    return onDistoReading((meters) => {
      if (arrowOnRef.current && arrowReadRef.current?.(meters)) return;
      const st = useField.getState();
      const prop = st.properties.find((p) => p.id === st.currentId);
      const units = prop?.units ?? "ft";
      const label = formatLength(metersToPlan(meters, units), units);
      const roomId = st.selectedRoomId;
      const wall = focusRef.current;
      if (!prop || roomId == null || wall == null) {
        setLaserNote({ label, detail: "Tap a wall, then shoot again.", reshoot: false });
        return;
      }
      const target = prop.rooms.find((r) => r.id === roomId);
      if (!target) return;
      const length = metersToPlan(meters, units);
      const next = setWallLength(target.points, wall, length);
      if (!next) {
        setLaserNote({ label, detail: "That length would fold the room.", reshoot: false });
        return;
      }
      lastShot.current = { roomId, wall, before: target.points, after: next };
      st.updateRoom(roomId, { points: next });
      setMenuOpen(false);
      const gap = closureGap(next);
      const gapNote = gap > 0.08 ? ` · gap ${formatLength(gap, units)}` : "";
      const rooms = prop.rooms
        .filter((r) => r.levelId === (levelRef.current || prop.levels[0]?.id))
        .map((r) => ({ id: r.id, wallCount: r.points.length }));
      const adv = advanceLaserTarget(rooms, roomId, wall);
      if (adv) {
        st.select(adv.roomId);
        setFocusWall(adv.wall);
        setLaserNote({ label, detail: `Wall ${wall + 1} set${gapNote} · next is wall ${adv.wall + 1}`, reshoot: true });
      } else {
        setFocusWall(wall);
        setLaserNote({ label, detail: `Wall ${wall + 1} set${gapNote} · last wall on this floor`, reshoot: true });
      }
    });
  }, []);

  const reshoot = () => {
    const shot = lastShot.current;
    if (!shot) return;
    const st = useField.getState();
    const prop = st.properties.find((p) => p.id === st.currentId);
    const target = prop?.rooms.find((r) => r.id === shot.roomId);
    const same =
      target &&
      target.points.length === shot.after.length &&
      target.points.every((p, i) => p.x === shot.after[i].x && p.y === shot.after[i].y);
    if (same) st.updateRoom(shot.roomId, { points: shot.before });
    st.select(shot.roomId);
    setFocusWall(shot.wall);
    setLaserNote((n) => (n ? { ...n, detail: "Ready — press DIST to re-shoot.", reshoot: false } : n));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const nextName = () => `Room ${property.rooms.length + 1}`;

  /** "Next room": the next room on this floor, or start adding a new one. */
  const nextRoom = () => {
    const i = property.rooms.findIndex((r) => r.id === selectedRoomId);
    const after = i >= 0 ? property.rooms[i + 1] : undefined;
    setFocusWall(null);
    if (after) {
      select(after.id);
    } else {
      select(null);
      setAdding(true);
    }
  };

  const startMode = (m: EditorMode) => {
    setMode(m);
    setOpeningPick(false);
    if (m === "stairs" || m === "draw") select(null);
    if (m === "draw") setDrawName(nextName());
  };

  const placeRoom = async (
    name: string,
    rawPoints: Pt[],
    source: FieldRoom["source"],
    photos: PreparedPhoto[] = [],
  ) => {
    // Typed sizes are exact tape readings: never snap them to the drawing grid
    // (12'7" used to become 12'6").
    const clean =
      source === "typed" ? ensureClockwise(rawPoints) : rectilinearize(rawPoints, gridStep(property.units));
    const origin = nextRoomOrigin(property.rooms);
    const r = newRoom(name, translate(clean, origin.x, origin.y), source);
    for (const p of photos) {
      const id = uid("photo");
      await savePhotoBlob(id, p.full).catch(() => {});
      r.photos.push({ id, thumb: p.thumb, takenAt: Date.now() });
    }
    addRoom(r);
    setFitNonce((n) => n + 1);
    toast.success(`${r.name} added — tap a wall length to adjust`);
  };

  /** Commit a whole walk-mode session as one undo step, on the current level. */
  const placeWalk = async (walked: WalkRoom[], doorWidth: number) => {
    const all = walked.flatMap((r) => r.points);
    const box = bbox(all);
    const origin = nextRoomOrigin(property.rooms);
    const gap = property.rooms.length ? gridStep(property.units) * 4 : 0;
    const dx = origin.x + gap - box.minX;
    const dy = origin.y - box.minY;
    const rooms: FieldRoom[] = [];
    const openings: FieldOpening[] = [];
    for (const w of walked) {
      const r = { ...newRoom(w.name, translate(w.points, dx, dy), "walk"), levelId };
      for (const p of (w.photos ?? []).slice(0, MAX_PHOTOS_PER_ROOM)) {
        const id = uid("photo");
        await savePhotoBlob(id, p.full).catch(() => {});
        r.photos.push({ id, thumb: p.thumb, takenAt: Date.now() });
      }
      rooms.push(r);
      if (w.door) {
        const at = { x: w.door.at.x + dx, y: w.door.at.y + dy };
        const hit = nearestWall(r.points, at);
        openings.push({
          id: uid("opening"),
          roomId: r.id,
          kind: "door",
          wall: hit.wall,
          offset: hit.offset,
          width: doorWidth,
        });
      }
    }
    change((p) => ({
      ...p,
      rooms: [...p.rooms, ...rooms],
      openings: [...p.openings, ...openings],
    }));
    select(rooms[rooms.length - 1].id);
    setFitNonce((n) => n + 1);
    toast.success(
      `${rooms.length} room${rooms.length > 1 ? "s" : ""} added — drag walls or type lengths to tidy up`,
    );
  };

  const MODE_HINT: Partial<Record<EditorMode, string>> = {
    draw: `Drag on the grid to draw ${drawName ?? "a room"}`,
    door: "Tap a wall to place a door",
    window: "Tap a wall to place a window",
    opening: "Tap a wall to place a doorway",
    stairs: "Tap where the stairs go",
    trace: "Drag to move the background",
    calibrate: "Tap two points on the background you know the distance between",
  };

  return (
    <div className="relative flex h-dvh flex-col bg-[#f6f2e8]">
      <header
        className="flex items-center gap-1 border-b border-black/10 bg-white px-2 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <IconBtn label="Back to properties" onClick={() => openProperty(null)}>
          <ArrowLeft />
        </IconBtn>
        <input
          aria-label="Property name"
          defaultValue={property.name}
          key={property.id + property.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== property.name &&
            change((p) => ({ ...p, name: e.target.value.trim() }))
          }
          className="h-12 min-w-[9.5rem] flex-1 rounded-lg bg-transparent px-2 text-lg font-bold"
        />
        <IconBtn
          label="Undo"
          onClick={() => {
            if (arrowUndoRef.current?.()) return;
            undo();
          }}
          disabled={!canUndo && !arrowOn}
        >
          <Undo2 />
        </IconBtn>
        <IconBtn label="Redo" onClick={redo} disabled={!canRedo}>
          <Redo2 />
        </IconBtn>
        <IconBtn label="Job settings" onClick={() => setJobOpen(true)}>
          <Settings2 />
        </IconBtn>
        <LaserButton onClick={() => { setArrowOn(false); setLaserOpen((open) => !open); }} />
        <HelpButton onClick={() => openHelp()} />
      </header>

      <LevelBar property={full} levelId={levelId} onTrace={() => setTraceOpen(true)} />

      <AreaBar
        property={full}
        levelId={levelId}
        onOpen={() => setShowMaterials(true)}
        onQuote={() => setShowQuote(true)}
        onSeams={() => setShowSeams((v) => !v)}
        seamsOn={showSeams}
        onUnits={() => setUnits(property.units === "ft" ? "m" : "ft")}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[calc(100%-1rem)]">
          <div className="pointer-events-auto">
            <LaserReadout
              label={
                laserNote?.label ||
                (disto.last ? formatLength(metersToPlan(disto.last.meters, property.units), property.units) : disto.status === "connected" ? disto.name || "DISTO" : "Laser")
              }
              detail={laserNote?.detail ?? null}
              onReshoot={laserNote?.reshoot ? reshoot : null}
            />
          </div>
        </div>
        <PlanEditor
          property={property}
          mode={mode}
          seamEdit={showSeams}
          drawName={drawName}
          onModeDone={() => setMode("select")}
          fitNonce={fitNonce}
          focusWall={focusWall}
          draft={arrowOn ? draft : null}
          draftOrigin={nextRoomOrigin(property.rooms)}
          onWallTap={(roomId, wall) => {
            select(roomId);
            setFocusWall(wall);
          }}
          onRoomTap={(id) => {
            if (id) setFocusWall(null);
          }}
          onSuppressMenu={() => setMenuOpen(false)}
          onOpeningTap={() => setFocusWall(null)}
          onCalibrate={(a, b) => {
            setMode("select");
            setCal({ a, b });
          }}
          onPhotoTap={(roomId, photoId) => setPhoto({ roomId, photoId })}
        />
        {property.rooms.length === 0 && mode === "select" && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-lg text-black/50">
            Tap <b>Add room</b> below to start.
            <br />
            Tap any room, wall length or door to edit it.
          </div>
        )}
        {showSeams && <SeamDock property={full} onClose={() => setShowSeams(false)} />}
        {mode !== "select" && (
          <div className="absolute inset-x-3 top-12 z-10 flex items-center gap-2 rounded-2xl bg-black/85 p-2 pl-4 text-base font-semibold text-white">
            <span className="flex-1">{MODE_HINT[mode]}</span>
            <button
              type="button"
              onClick={() => setMode("select")}
              className="h-12 rounded-xl bg-white px-5 text-base font-bold text-black"
            >
              Cancel
            </button>
          </div>
        )}

        {traceOpen && !((stairs || room) && mode === "select") && (
          <div className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-[#fbf7ed] shadow-[0_-8px_24px_rgba(0,0,0,0.15)]">
            <TracePanel
              property={full}
              levelId={levelId}
              mode={mode}
              setMode={setMode}
              onClose={() => {
                setTraceOpen(false);
                if (mode === "trace" || mode === "calibrate") setMode("select");
              }}
            />
          </div>
        )}
        {(stairs || room) && mode === "select" && (
          <SelectionBar
            property={property}
            room={room}
            stairs={stairs}
            open={menuOpen}
            focusWall={focusWall}
            keyboard={keyboard}
            onOpenChange={setMenuOpen}
          >
            {stairs ? (
              <StairsPanel property={property} stairs={stairs} onClose={() => selectStairs(null)} />
            ) : (
              <RoomPanel
                property={property}
                room={room!}
                focusWall={focusWall}
                selectedOpeningId={selectedOpeningId}
                onPlace={(k) => setMode(k)}
                onNext={nextRoom}
                onClose={() => {
                  select(null);
                  setFocusWall(null);
                }}
                onViewPhoto={(photoId) => setPhoto({ roomId: room!.id, photoId })}
              />
            )}
          </SelectionBar>
        )}
      </div>

      {laserOpen && !arrowOn && (
        <LaserSheet
          units={property.units}
          onClose={() => setLaserOpen(false)}
          onDraw={() => {
            setLaserOpen(false);
            select(null);
            setFocusWall(null);
            setArrowOn(true);
          }}
        />
      )}
      {arrowOn && (
        <ArrowSheet
          units={property.units}
          levelId={levelId}
          origin={nextRoomOrigin(property.rooms)}
          defaultName={nextName()}
          undoRef={arrowUndoRef}
          readingRef={arrowReadRef}
          storageId={full.id}
          onDraft={setDraft}
          onCommit={(committed) => {
            change((p) => ({
              ...p,
              rooms: [...p.rooms, committed.room, ...committed.closets],
              openings: [...p.openings, ...committed.openings],
            }));
            select(committed.room.id);
            setFocusWall(0);
            const gap = formatLength(committed.closingError, property.units);
            setLaserNote({
              label: committed.room.name,
              detail: `Closed. Gap to the start was ${gap}.`,
              reshoot: false,
            });
            toast.success(`${committed.room.name} closed · gap ${gap}`);
          }}
          onClose={() => setArrowOn(false)}
        />
      )}

      <nav
        className="grid grid-cols-6 gap-1 border-t border-black/10 bg-white px-1 pt-1"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
        aria-label="Tools"
      >
        <ToolBtn label="Add room" primary onClick={() => setAdding(true)}>
          <Plus />
        </ToolBtn>
        <ToolBtn label="Draw" active={mode === "draw"} onClick={() => startMode("draw")}>
          <Grid2x2Plus />
        </ToolBtn>
        <ToolBtn
          label="Doors"
          active={mode === "door" || mode === "window" || mode === "opening"}
          onClick={() => setOpeningPick(true)}
        >
          <DoorOpen />
        </ToolBtn>
        <ToolBtn label="Stairs" active={mode === "stairs"} onClick={() => startMode("stairs")}>
          <StairsIcon />
        </ToolBtn>
        <ToolBtn label="Materials" onClick={() => setShowMaterials(true)}>
          <Layers />
        </ToolBtn>
        <ToolBtn label="Export" onClick={() => setMenu(true)}>
          <Download />
        </ToolBtn>
      </nav>

      {adding && (
        <AddRoomSheet
          units={property.units}
          defaultName={nextName()}
          onClose={() => setAdding(false)}
          onPick={(how, name, size) => {
            setAdding(false);
            if (how === "draw") {
              setMode("draw");
              setDrawName(name);
            } else if (how === "typed" && size) {
              void placeRoom(name, size.points ?? rectPoints(0, 0, size.w, size.h), "typed");
            } else if (how === "sketch") {
              setSketchOpen(true);
            } else if (how === "photoshape") {
              setShapeOpen(name);
            } else if (how === "trace") {
              setTraceOpen(true);
            } else if (how === "ar" || how === "walk" || how === "walkmode") {
              setCapture({ kind: how, name });
            }
          }}
        />
      )}

      {openingPick && (
        <Sheet title="Doors, windows & transitions" onClose={() => setOpeningPick(false)}>
          <div className="grid gap-2">
            <p className="text-base text-black/60">
              {room
                ? `Then tap a wall of ${room.name}.`
                : "Then tap any wall on the plan."}{" "}
              Tap a placed door later to set its width, position and transition.
            </p>
            <MethodBtn icon={<DoorOpen />} title="Door" body="Swing door with transition." onClick={() => startMode("door")} />
            <MethodBtn icon={<RectangleVertical />} title="Doorway / opening" body="Cased opening, no door. Gets a transition." onClick={() => startMode("opening")} />
            <MethodBtn icon={<PanelTop />} title="Window" body="Shown on the plan only." onClick={() => startMode("window")} />
          </div>
        </Sheet>
      )}

      {sketchOpen && (
        <SketchImport
          property={full}
          levelId={levelId}
          onClose={() => setSketchOpen(false)}
          onTraceInstead={() => {
            setTraceOpen(true);
            setFitNonce((n) => n + 1);
          }}
        />
      )}
      {shapeOpen && (
        <PhotoShape
          property={full}
          defaultName={shapeOpen}
          onClose={() => setShapeOpen(null)}
          onDone={(name, pts, photos) => {
            setShapeOpen(null);
            const o = nextRoomOrigin(property.rooms);
            const b = bbox(pts);
            const r = newRoom(name, translate(pts, o.x - b.minX, o.y - b.minY), "typed");
            r.photos.push(...photos);
            addRoom(r);
            setFitNonce((n) => n + 1);
            toast.success(`${r.name} added with ${pts.length} walls`);
          }}
        />
      )}
      {cal && <CalibrateSheet property={full} levelId={levelId} a={cal.a} b={cal.b} onClose={() => setCal(null)} />}

      {jobOpen && <JobSettingsSheet property={full} onClose={() => setJobOpen(false)} />}

      {capture?.kind === "ar" && (
        <ArCapture
          units={property.units}
          onCancel={(reason) => {
            setCapture(null);
            if (reason) toast.error(reason);
          }}
          onDone={(pts) => {
            const name = capture.name;
            setCapture(null);
            if (pts.length < 3) return toast.error("Need at least 3 corners");
            void placeRoom(name, pts, "ar");
          }}
        />
      )}
      {capture?.kind === "walk" && (
        <WalkCapture
          units={property.units}
          onCancel={() => setCapture(null)}
          onDone={(pts, photos) => {
            const name = capture.name;
            setCapture(null);
            void placeRoom(name, pts, "walk", photos);
          }}
        />
      )}

      {capture?.kind === "walkmode" && (
        <WalkMode
          units={property.units}
          firstName={capture.name}
          roomCount={property.rooms.length}
          onCancel={() => setCapture(null)}
          onDone={(walked, doorWidth) => {
            setCapture(null);
            void placeWalk(walked, doorWidth);
          }}
        />
      )}

      {photo && <PhotoViewer property={property} {...photo} onClose={() => setPhoto(null)} />}
      {menu && <ExportSheet property={full} onClose={() => setMenu(false)} />}
      {showMaterials && <MaterialsScreen property={full} onClose={() => setShowMaterials(false)} />}
      {showQuote && <QuoteSheet property={full} onClose={() => setShowQuote(false)} />}
      {welcome && !helpOpen && (
        <WelcomeTip
          onStart={() => {
            dismissWelcome();
            openHelp("draw-room");
          }}
          onDismiss={() => {
            dismissWelcome();
            setWelcome(false);
          }}
        />
      )}
      {helpOpen && <TutorialHost app="beta" topic={helpTopic} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  active,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold ${primary ? "bg-[#b4561d] text-white" : active ? "bg-black text-white" : "text-black/80 active:bg-black/10"}`}
    >
      {children}
      {label}
    </button>
  );
}

/** Always-visible live square footage: this floor, whole property, units and a Materials shortcut. */
function AreaBar({
  property,
  levelId,
  onOpen,
  onQuote,
  onSeams,
  seamsOn,
  onUnits,
}: {
  property: FieldProperty;
  levelId: string;
  onOpen: () => void;
  onQuote: () => void;
  onSeams: () => void;
  seamsOn: boolean;
  onUnits: () => void;
}) {
  const s = areaSummary(property);
  const lvl = s.levels.find((l) => l.id === levelId);
  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-black/10 bg-[#fff8ec] px-3 text-base">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 flex-1 items-center gap-3 text-left"
        aria-label="Open materials summary"
      >
        {property.levels.length > 1 && lvl && (
          <span>
            {lvl.name} <b>{formatArea(lvl.area, property.units)}</b>
          </span>
        )}
        <span>
          Total <b>{formatArea(s.total, property.units)}</b>
        </span>
      </button>
      <button
        type="button"
        onClick={onQuote}
        className="h-10 rounded-full bg-[#b4561d] px-3 text-sm font-semibold text-white"
      >
        Quote
      </button>
      <button
        type="button"
        onClick={onSeams}
        aria-pressed={seamsOn}
        className={`h-10 rounded-full px-3 text-sm font-semibold ${seamsOn ? "bg-black text-white" : "bg-black/5"}`}
      >
        Seams
      </button>
      <button
        type="button"
        onClick={onUnits}
        aria-label="Switch units"
        className="h-10 rounded-full bg-black/5 px-4 text-sm font-semibold"
      >
        {property.units === "ft" ? "ft" : "m"}
      </button>
    </div>
  );
}

function LevelBar({
  property,
  levelId,
  onTrace,
}: {
  property: FieldProperty;
  levelId: string;
  onTrace: () => void;
}) {
  const setLevel = useField((s) => s.setLevel);
  const addLevel = useField((s) => s.addLevel);
  const renameLevel = useField((s) => s.renameLevel);
  const deleteLevel = useField((s) => s.deleteLevel);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  useBackClose(editing, () => setEditing(false));
  const current = property.levels.find((l) => l.id === levelId);
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b border-black/10 bg-white px-3 py-2"
      role="tablist"
      aria-label="Levels"
    >
      {property.levels.map((l) => {
        const on = l.id === levelId;
        return (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              if (!on) return setLevel(l.id);
              setName(l.name);
              setEditing(true);
            }}
            className={`flex h-12 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 text-base font-semibold ${on ? "bg-black text-white" : "bg-black/5"}`}
          >
            {l.name}
            {on && <Pencil className="size-4 opacity-70" aria-label="Rename" />}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const n = nextLevelName(property);
          addLevel(n);
          toast(`${n} added — tap it to rename`);
        }}
        className="flex h-12 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-black/30 px-4 text-base font-semibold"
      >
        <Plus className="size-4" /> Level
      </button>
      <button
        type="button"
        onClick={onTrace}
        className={`ml-auto flex h-12 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 text-base font-semibold ${property.levels.find((l) => l.id === levelId)?.trace ? "bg-[#f3dcc3] text-[#8a3b12]" : "bg-black/5"}`}
      >
        <ImageIcon className="size-4" /> Trace
      </button>
      {editing && current && (
        <Sheet title="Floor / level" onClose={() => setEditing(false)}>
          <div className="space-y-3">
            <input
              aria-label="Level name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameLevel(levelId, name);
                  setEditing(false);
                }
              }}
              className="h-14 w-full rounded-xl border border-black/15 px-4 text-xl"
            />
            <button
              type="button"
              onClick={() => {
                renameLevel(levelId, name);
                setEditing(false);
              }}
              className="h-14 w-full rounded-xl bg-black text-lg font-bold text-white"
            >
              Save name
            </button>
            {property.levels.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const n = property.rooms.filter((r) => r.levelId === levelId).length;
                  deleteLevel(levelId);
                  setEditing(false);
                  toast(`${current.name}${n ? ` and ${n} room(s)` : ""} deleted`, {
                    action: { label: "Undo", onClick: () => useField.getState().undo() },
                  });
                }}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-red-800/30 text-base font-semibold text-red-800"
              >
                <Trash2 className="size-5" /> Delete this level
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-12 shrink-0 items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Sheet({
  onClose,
  children,
  title,
  helpId,
}: {
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  helpId?: string;
}) {
  useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="flex-1 text-2xl font-bold">{title}</h2>
          {helpId && <HelpMark id={helpId} />}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-12 items-center justify-center rounded-full bg-black/5 text-2xl"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddRoomSheet({
  units,
  defaultName,
  onClose,
  onPick,
}: {
  units: Units;
  defaultName: string;
  onClose: () => void;
  onPick: (
    how: "ar" | "walk" | "walkmode" | "draw" | "typed" | "sketch" | "photoshape" | "trace",
    name: string,
    size?: { w: number; h: number; points?: Pt[] },
  ) => void;
}) {
  const [name, setName] = useState("");
  const [ar, setAr] = useState<boolean | null>(null);
  useEffect(() => {
    void isArSupported().then(setAr);
  }, []);
  const n = name.trim() || defaultName;

  return (
    <Sheet title="Add a room" onClose={onClose}>
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-base font-semibold" htmlFor="room-name">
            What room is it?
          </label>
          <input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            className="h-14 w-full rounded-xl border border-black/15 px-4 text-xl"
          />
          <div className="flex flex-wrap gap-2">
            {ROOM_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setName(p)}
                className={`h-11 rounded-full px-4 text-base ${name === p ? "bg-black text-white" : "bg-black/5"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <QuickSize units={units} name={n} onPick={onPick} />
        <div className="space-y-2">
          <div className="text-base font-semibold">Or capture / draw the shape</div>
          <MethodBtn
            icon={<FileText />}
            title="Auto from sketch"
            body="Photo of your hand sketch (12'8 x 13'9, M.B.R.…). Rooms are read on the phone; you review before adding."
            onClick={() => onPick("sketch", n)}
          />
          <MethodBtn
            icon={<Camera />}
            title="Room shape from photos"
            body="Tap the floor corners on 1+ photos to get the shape and wall count, then type each wall length."
            onClick={() => onPick("photoshape", n)}
          />
          <MethodBtn
            icon={<ImageIcon />}
            title="Trace over a sketch / photo"
            body="Put an image behind this floor, calibrate it, and draw on top."
            onClick={() => onPick("trace", n)}
          />
          <MethodBtn
            icon={<ScanLine />}
            title="AR corners"
            body={
              ar === false
                ? "Not available here. AR needs Chrome on Android with ARCore (not the Floorline app). Use Camera walk instead."
                : "Point at each floor corner. Best on Android Chrome."
            }
            disabled={ar === false}
            onClick={() => onPick("ar", n)}
          />
          <MethodBtn
            icon={<Footprints />}
            title="Walk mode (room to room)"
            body="Just walk along the walls. Steps + compass draw the path; tap Doorway between rooms."
            onClick={() => onPick("walkmode", n)}
          />
          <MethodBtn
            icon={<Footprints />}
            title="Camera walk"
            body="Live camera. Tap left/right at each corner. Works on any phone."
            onClick={() => onPick("walk", n)}
          />
          <MethodBtn
            icon={<Grid2x2Plus />}
            title="Draw on grid"
            body="Drag a rectangle, then drag corners and walls."
            onClick={() => onPick("draw", n)}
          />
        </div>
      </div>
    </Sheet>
  );
}

function QuickSize({
  units,
  name,
  onPick,
}: {
  units: Units;
  name: string;
  onPick: (how: "typed", name: string, size: { w: number; h: number; points?: Pt[] }) => void;
}) {
  const [shape, setShape] = useState<"rect" | "l">("rect");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [cw, setCw] = useState("");
  const [ch, setCh] = useState("");
  const [corner, setCorner] = useState<"tr" | "tl" | "br" | "bl">("tr");
  const pw = parseLength(w, units);
  const ph = parseLength(h, units);
  const pcw = parseLength(cw, units);
  const pch = parseLength(ch, units);
  const lPts = shape === "l" && pw && ph && pcw && pch ? lShapePoints(pw, ph, pcw, pch, corner) : null;
  const ok = shape === "rect" ? Boolean(pw && ph && pw > 0 && ph > 0) : Boolean(lPts);
  const go = () => {
    if (!ok || !pw || !ph) {
      if (shape === "l" && pw && ph && pcw && pch) toast.error("The cut-out must be smaller than the room");
      return;
    }
    onPick("typed", name, { w: pw, h: ph, points: lPts ?? undefined });
  };
  const box = "h-14 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 text-xl";
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && go();
  return (
    <div className="space-y-2 rounded-2xl bg-[#f3dcc3]/50 p-3" data-testid="quick-size">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Ruler className="size-5" /> Fastest: type the size
      </div>
      <div className="flex rounded-xl bg-black/[0.05] p-1" role="radiogroup" aria-label="Room shape">
        {(
          [
            ["rect", "Rectangle"],
            ["l", "L-shape"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={shape === k}
            onClick={() => setShape(k)}
            className={`h-11 flex-1 rounded-lg text-base font-semibold ${shape === k ? "bg-black text-white" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input aria-label="Width" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} onKeyDown={enter} placeholder={units === "ft" ? "12'6\"" : "3.6"} className={box} />
        <span className="text-xl">×</span>
        <input aria-label="Length" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} onKeyDown={enter} placeholder={units === "ft" ? "10'" : "3.0"} className={box} />
      </div>
      {shape === "l" && (
        <>
          <div className="text-sm text-black/60">Cut-out (the missing corner)</div>
          <div className="flex items-center gap-2">
            <input aria-label="Cut-out width" inputMode="decimal" value={cw} onChange={(e) => setCw(e.target.value)} onKeyDown={enter} placeholder="4'" className={box} />
            <span className="text-xl">×</span>
            <input aria-label="Cut-out length" inputMode="decimal" value={ch} onChange={(e) => setCh(e.target.value)} onKeyDown={enter} placeholder="3'" className={box} />
          </div>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Cut-out corner">
            {(
              [
                ["tl", "↖"],
                ["tr", "↗"],
                ["bl", "↙"],
                ["br", "↘"],
              ] as const
            ).map(([k, a]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={corner === k}
                onClick={() => setCorner(k)}
                className={`h-11 rounded-lg text-xl ${corner === k ? "bg-black text-white" : "bg-black/5"}`}
              >
                {a}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        disabled={!ok}
        onClick={go}
        className="h-14 w-full rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-30"
      >
        Add {name}
      </button>
      <p className="text-xs text-black/50">Exact: 12, 12.5, 12'6" or 12 6. Islands and closets: add them in the room panel.</p>
    </div>
  );
}

function MethodBtn({
  icon,
  title,
  body,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-20 w-full items-center gap-4 rounded-2xl border border-black/10 p-4 text-left disabled:opacity-40"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#f3dcc3] text-[#8a3b12]">
        {icon}
      </span>
      <span>
        <span className="block text-lg font-bold">{title}</span>
        <span className="block text-sm text-black/60">{body}</span>
      </span>
    </button>
  );
}

function PhotoViewer({
  property,
  roomId,
  photoId,
  onClose,
}: {
  property: FieldProperty;
  roomId: string;
  photoId: string;
  onClose: () => void;
}) {
  const room = property.rooms.find((r) => r.id === roomId);
  const ph = room?.photos.find((p) => p.id === photoId);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void loadPhotoBlob(photoId)
      .then((b) => {
        if (b) {
          url = URL.createObjectURL(b);
          setSrc(url);
        }
      })
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId]);
  if (!room || !ph) return null;
  const isVideo = ph.kind === "video";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" onClick={onClose}>
      <div className="p-4 text-white" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
        <div className="text-xl font-bold">{room.name}</div>
        <div className="text-sm text-white/70">
          {new Date(ph.takenAt).toLocaleString()}
          {ph.geo ? (
            <>
              {" · "}
              <a
                href={mapsUrl(ph.geo)}
                target="_blank"
                rel="noreferrer"
                className="underline"
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin className="inline size-3" /> {formatGeo(ph.geo)}
              </a>
            </>
          ) : (
            " · no location"
          )}
        </div>
      </div>
      {isVideo ? (
        src ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="min-h-0 flex-1 bg-black"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img src={ph.thumb} alt={room.name} className="min-h-0 flex-1 object-contain" />
        )
      ) : (
        <img src={src ?? ph.thumb} alt={room.name} className="min-h-0 flex-1 object-contain" />
      )}
      <button type="button" className="m-4 h-14 rounded-2xl bg-white/15 text-lg text-white">
        Close
      </button>
    </div>
  );
}

function ExportSheet({ property, onClose }: { property: FieldProperty; onClose: () => void }) {
  const run = (fn: () => Promise<unknown> | void, ok: string) => async () => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") toast.error("Export failed");
    }
    onClose();
  };
  return (
    <Sheet title="Export plan" helpId="pdf" onClose={onClose}>
      <div className="grid gap-2">
        <MethodBtn
          icon={<Share2 />}
          title="Share image"
          body="Send the PNG by text, email or Drive."
          onClick={run(() => sharePng(property), "Ready")}
        />
        <MethodBtn
          icon={<ImageIcon />}
          title="Download PNG"
          body="High-resolution plan with labels and photos."
          onClick={run(() => exportPng(property), "PNG saved")}
        />
        <MethodBtn
          icon={<FileText />}
          title="Share PDF floor plan"
          body="Title block, scaled plan, materials table and room snapshots."
          onClick={run(() => sharePdf(property), "PDF ready")}
        />
        <MethodBtn
          icon={<FileText />}
          title="Printable page"
          body="Opens a print view (browser “Save as PDF”)."
          onClick={run(() => printPdf(property), "Opened print view")}
        />
        <MethodBtn
          icon={<FileJson />}
          title="JSON backup"
          body="Re-import later or on another device."
          onClick={run(() => exportJson(property), "JSON saved")}
        />
      </div>
    </Sheet>
  );
}
