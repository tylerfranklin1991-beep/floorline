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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isArSupported } from "@/lib/field/ar";
import { exportJson, exportPng, printPdf, sharePng } from "@/lib/field/export";
import {
  area,
  bbox,
  formatArea,
  gridStep,
  levelView,
  nearestWall,
  nextLevelName,
  nextRoomOrigin,
  newRoom,
  parseLength,
  rectilinearize,
  rectPoints,
  ensureClockwise,
  lShapePoints,
  ROOM_PRESETS,
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
import { MaterialsScreen } from "./materials-screen";
import { JobSettingsSheet } from "./job-settings";
import { sharePdf } from "@/lib/field/pdf";
import { areaSummary } from "@/lib/field/materials";
import { PlanEditor, type EditorMode } from "./plan-editor";
import { RoomPanel } from "./room-panel";
import { StairsPanel } from "./stairs-panel";
import { WalkCapture } from "./walk-capture";
import { WalkMode, type WalkRoom } from "./walk-mode";

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
  const [fitNonce, setFitNonce] = useState(0);
  const [drawName, setDrawName] = useState<string | null>(null);
  const room = property.rooms.find((r) => r.id === selectedRoomId) ?? null;

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
    toast.success(`${r.name} added — now check the wall lengths`);
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

  const step = property.rooms.length === 0 ? 1 : !room ? 2 : 3;

  return (
    <div className="flex h-dvh flex-col bg-[#f6f2e8]">
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
          key={property.id}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== property.name &&
            change((p) => ({ ...p, name: e.target.value.trim() }))
          }
          className="h-12 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-lg font-bold"
        />
        <IconBtn label="Undo" onClick={undo} disabled={!canUndo}>
          <Undo2 />
        </IconBtn>
        <IconBtn label="Redo" onClick={redo} disabled={!canRedo}>
          <Redo2 />
        </IconBtn>
        <IconBtn label="Job settings" onClick={() => setJobOpen(true)}>
          <Settings2 />
        </IconBtn>
        <IconBtn label="Export" onClick={() => setMenu(true)}>
          <Download />
        </IconBtn>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto bg-white/70 px-3 py-2 text-sm">
        {["Add a room", "Capture or draw it", "Name, measure, photo"].map((t, i) => (
          <span
            key={t}
            className={`whitespace-nowrap rounded-full px-3 py-1 ${step === i + 1 ? "bg-[#b4561d] text-white" : "bg-black/5 text-black/60"}`}
          >
            {i + 1}. {t}
          </span>
        ))}
      </div>

      <LevelBar property={full} levelId={levelId} />

      <AreaBar property={full} levelId={levelId} onOpen={() => setShowMaterials(true)} />

      <div className="relative min-h-0 flex-1">
        <PlanEditor
          property={property}
          mode={mode}
          drawName={drawName}
          onModeDone={() => setMode("select")}
          fitNonce={fitNonce}
          onWallTap={(roomId, wall) => {
            select(roomId);
            setFocusWall(wall);
          }}
          onPhotoTap={(roomId, photoId) => setPhoto({ roomId, photoId })}
        />
        {property.rooms.length === 0 && mode === "select" && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-lg text-black/50">
            Tap “Add room” to start
          </div>
        )}
        {mode !== "select" && (
          <button
            type="button"
            onClick={() => setMode("select")}
            className="absolute bottom-3 left-3 h-12 rounded-full bg-black px-5 text-base font-semibold text-white"
          >
            Cancel
          </button>
        )}
      </div>

      {stairs ? (
        <div
          className="max-h-[55dvh] overflow-y-auto border-t border-black/10 bg-[#fbf7ed]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <StairsPanel property={property} stairs={stairs} onClose={() => selectStairs(null)} />
        </div>
      ) : room ? (
        <div
          className="max-h-[55dvh] overflow-y-auto border-t border-black/10 bg-[#fbf7ed]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <RoomPanel
            property={property}
            room={room}
            focusWall={focusWall}
            onPlace={(k) => setMode(k)}
            onClose={() => {
              select(null);
              setFocusWall(null);
            }}
            onViewPhoto={(photoId) => setPhoto({ roomId: room.id, photoId })}
          />
        </div>
      ) : (
        <div
          className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-black/10 bg-white p-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-xl font-bold text-white"
          >
            <Plus /> Add room
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("stairs");
              select(null);
            }}
            className="flex h-16 flex-col items-center justify-center rounded-2xl bg-black/5 px-3 text-sm font-semibold"
          >
            <StairsIcon className="size-5" /> Stairs
          </button>
          <button
            type="button"
            onClick={() => setUnits(property.units === "ft" ? "m" : "ft")}
            className="h-16 rounded-2xl bg-black/5 px-4 text-base font-semibold"
            aria-label="Switch units"
          >
            {property.units === "ft" ? "ft" : "m"}
          </button>
        </div>
      )}

      {adding && (
        <AddRoomSheet
          units={property.units}
          defaultName={`Room ${property.rooms.length + 1}`}
          onClose={() => setAdding(false)}
          onPick={(how, name, size) => {
            setAdding(false);
            if (how === "draw") {
              toast("Drag on the grid to draw " + name);
              setMode("draw");
              setDrawName(name);
            } else if (how === "typed" && size) {
              void placeRoom(name, size.points ?? rectPoints(0, 0, size.w, size.h), "typed");
            } else if (how === "ar" || how === "walk" || how === "walkmode") {
              setCapture({ kind: how, name });
            }
          }}
        />
      )}

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
    </div>
  );
}

/** Always-visible live square footage: this floor, whole property, and a Materials shortcut. */
function AreaBar({
  property,
  levelId,
  onOpen,
}: {
  property: FieldProperty;
  levelId: string;
  onOpen: () => void;
}) {
  const s = areaSummary(property);
  const lvl = s.levels.find((l) => l.id === levelId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-12 items-center gap-3 border-b border-black/10 bg-[#fff8ec] px-3 text-left text-base"
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
      <span className="ml-auto rounded-full bg-[#b4561d] px-3 py-1 text-sm font-semibold text-white">
        Materials
      </span>
    </button>
  );
}

function LevelBar({ property, levelId }: { property: FieldProperty; levelId: string }) {
  const setLevel = useField((s) => s.setLevel);
  const addLevel = useField((s) => s.addLevel);
  const renameLevel = useField((s) => s.renameLevel);
  const deleteLevel = useField((s) => s.deleteLevel);
  const current = property.levels.find((l) => l.id === levelId);
  const edit = () => {
    if (!current) return;
    const name = window.prompt(
      property.levels.length > 1
        ? `Rename "${current.name}" (leave empty and OK to delete this level)`
        : `Rename "${current.name}"`,
      current.name,
    );
    if (name === null) return;
    if (!name.trim() && property.levels.length > 1) {
      const n = property.rooms.filter((r) => r.levelId === levelId).length;
      if (
        window.confirm(
          `Delete ${current.name}${n ? ` and its ${n} room(s)` : ""}? You can undo this.`,
        )
      )
        deleteLevel(levelId);
      return;
    }
    renameLevel(levelId, name);
  };
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
            onClick={() => (on ? edit() : setLevel(l.id))}
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
          const name = window.prompt("Name the new level", nextLevelName(property));
          if (name !== null) addLevel(name || nextLevelName(property));
        }}
        className="flex h-12 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-black/30 px-4 text-base font-semibold"
      >
        <Plus className="size-4" /> Level
      </button>
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
}: {
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-2xl font-bold">{title}</h2>
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
    how: "ar" | "walk" | "walkmode" | "draw" | "typed",
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
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" onClick={onClose}>
      <div className="p-4 text-xl font-bold text-white">{room.name}</div>
      <img src={src ?? ph.thumb} alt={room.name} className="min-h-0 flex-1 object-contain" />
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
    <Sheet title="Export plan" onClose={onClose}>
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
