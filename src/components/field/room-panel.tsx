import { DoorOpen, PanelTop, RectangleVertical, Trash2, X } from "lucide-react";

/** User-facing name for each opening kind ("opening" reads as a doorway). */
export const OPENING_LABEL = { door: "Door", window: "Window", opening: "Doorway" } as const;
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  area,
  edges,
  formatArea,
  formatLength,
  parseLength,
  ROOM_PRESETS,
  setWallLength,
  type FieldProperty,
  type FieldRoom,
} from "@/lib/field/model";
import { useField } from "@/lib/field/store";
import {
  roomFlooring,
  TRANSITION_LABEL,
  transitions,
  type RoomFlooring,
  type TransitionType,
} from "@/lib/field/materials";
import { PhotoSlots } from "./photo-slots";
import { AreasSection, FlooringSection } from "./room-flooring";

const WALL_NAMES = (room: FieldRoom) =>
  edges(room.points).map((e) => {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    // Clockwise outline: travelling +x is the top (north) wall, etc.
    if (e.horizontal) return dx > 0 ? "Top" : "Bottom";
    return dy > 0 ? "Right" : "Left";
  });

export function LengthInput({
  value,
  units,
  onCommit,
  autoFocus,
  label,
}: {
  value: number;
  units: FieldProperty["units"];
  onCommit: (n: number) => boolean;
  autoFocus?: boolean;
  label: string;
}) {
  const [text, setText] = useState(formatLength(value, units));
  useEffect(() => setText(formatLength(value, units)), [value, units]);
  const commitText = () => {
    const n = parseLength(text, units);
    if (n == null || n <= 0) {
      toast.error(`Couldn't read "${text}". Try 12, 12.5 or 12'6"`);
      setText(formatLength(value, units));
      return;
    }
    if (Math.abs(n - value) < 1e-6) return;
    if (!onCommit(n)) {
      toast.error("That length would fold the room over itself — adjust another wall first.");
      setText(formatLength(value, units));
    }
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      autoFocus={autoFocus}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commitText}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-12 w-28 rounded-xl border border-black/15 bg-white px-3 text-right text-lg font-semibold"
    />
  );
}

export function RoomPanel({
  property,
  room,
  focusWall,
  onPlace,
  onClose,
  onViewPhoto,
}: {
  property: FieldProperty;
  room: FieldRoom;
  focusWall: number | null;
  onPlace: (kind: "door" | "window" | "opening") => void;
  onClose: () => void;
  onViewPhoto: (photoId: string) => void;
}) {
  const updateRoom = useField((s) => s.updateRoom);
  const deleteRoom = useField((s) => s.deleteRoom);
  const preview = useField((s) => s.preview);
  const beginDrag = useField((s) => s.beginDrag);
  const commitDrag = useField((s) => s.commitDrag);
  const updateOpening = useField((s) => s.updateOpening);
  const deleteOpening = useField((s) => s.deleteOpening);
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.id, room.name]);
  const names = WALL_NAMES(room);
  const openings = property.openings.filter((o) => o.roomId === room.id);
  const u = property.units;
  const fl = roomFlooring(room, property.job);
  const setFl = (patch: Partial<RoomFlooring>) =>
    updateRoom(room.id, { flooring: { ...(room.flooring ?? {}), ...patch } });
  const trs = transitions(property);

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm uppercase tracking-wide text-black/50">
            Room · {formatArea(area(room.points), u)}
          </div>
          <div className="text-xs text-black/40">
            {room.source === "ar"
              ? "Captured with AR"
              : room.source === "walk"
                ? "Captured with camera walk"
                : "Drawn by hand"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close room panel"
          className="flex size-12 items-center justify-center rounded-full bg-black/5"
        >
          <X />
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="text-base font-bold">1 · Name</h3>
        <input
          aria-label="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name.trim() && name !== room.name && updateRoom(room.id, { name: name.trim() })
          }
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-14 w-full rounded-xl border border-black/15 bg-white px-4 text-xl font-semibold"
        />
        <div className="flex flex-wrap gap-2">
          {ROOM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => updateRoom(room.id, { name: p })}
              className="h-11 rounded-full bg-black/5 px-4 text-base"
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-bold">2 · Wall lengths</h3>
        <p className="text-sm text-black/55">
          Type your tape or laser reading. The opposite wall adjusts so the room stays square.
        </p>
        <div className="space-y-2">
          {edges(room.points).map((e) => (
            <div
              key={e.index}
              className={`flex items-center justify-between rounded-xl px-3 py-1 ${focusWall === e.index ? "bg-[#f3dcc3]" : "bg-black/[0.03]"}`}
            >
              <span className="text-base">
                Wall {e.index + 1} <span className="text-black/50">({names[e.index]})</span>
                <label className="ml-1 inline-flex items-center gap-1 text-xs text-black/60">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={!fl.noBaseWalls.includes(e.index)}
                    onChange={(ev) =>
                      setFl({
                        noBaseWalls: ev.target.checked
                          ? fl.noBaseWalls.filter((w) => w !== e.index)
                          : [...fl.noBaseWalls, e.index],
                      })
                    }
                  />
                  base
                </label>
              </span>
              <LengthInput
                label={`Wall ${e.index + 1} length`}
                value={e.length}
                units={u}
                autoFocus={focusWall === e.index}
                onCommit={(n) => {
                  const next = setWallLength(room.points, e.index, n);
                  if (!next) return false;
                  updateRoom(room.id, { points: next });
                  return true;
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-bold">3 · Doors &amp; windows</h3>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onPlace("door")}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold"
          >
            <DoorOpen className="size-5" /> Door
          </button>
          <button
            type="button"
            onClick={() => onPlace("window")}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold"
          >
            <PanelTop className="size-5" /> Window
          </button>
          <button
            type="button"
            onClick={() => onPlace("opening")}
            aria-label="Doorway / opening (no door)"
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold"
          >
            <RectangleVertical className="size-5 shrink-0" /> Doorway
          </button>
        </div>
        {openings.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] p-2"
          >
            <span className="w-20 text-base font-semibold">{OPENING_LABEL[o.kind]}</span>
            <span className="text-sm text-black/50">wall {o.wall + 1}</span>
            <span className="ml-auto text-sm">width</span>
            <LengthInput
              label={`${OPENING_LABEL[o.kind]} width`}
              value={o.width}
              units={u}
              onCommit={(n) => (updateOpening(o.id, { width: n }), true)}
            />
            <span className="text-sm">from corner</span>
            <LengthInput
              label={`${OPENING_LABEL[o.kind]} position`}
              value={o.offset}
              units={u}
              onCommit={(n) => (updateOpening(o.id, { offset: n }), true)}
            />
            {o.kind !== "window" && (
              <label className="flex w-full items-center gap-2 text-sm">
                Transition
                <select
                  aria-label="Transition type"
                  className="h-11 flex-1 rounded-xl border border-black/15 bg-white px-2 text-base"
                  value={o.transition ?? "auto"}
                  onChange={(ev) =>
                    updateOpening(o.id, {
                      transition:
                        ev.target.value === "auto"
                          ? undefined
                          : (ev.target.value as TransitionType),
                    })
                  }
                >
                  <option value="auto">
                    Auto (
                    {
                      TRANSITION_LABEL[
                        trs.find((t) => t.openingId === o.id || t.twinOpeningId === o.id)?.type ??
                          "t-mold"
                      ]
                    }
                    )
                  </option>
                  {(Object.keys(TRANSITION_LABEL) as TransitionType[]).map((t) => (
                    <option key={t} value={t}>
                      {TRANSITION_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              aria-label={`Delete ${OPENING_LABEL[o.kind].toLowerCase()}`}
              onClick={() => deleteOpening(o.id)}
              className="flex size-12 items-center justify-center rounded-full"
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        ))}
      </section>

      <FlooringSection property={property} room={room} />

      <AreasSection property={property} room={room} />

      <section className="space-y-2">
        <h3 className="text-base font-bold">4 · Photos</h3>
        <p className="text-sm text-black/55">
          1–2 snapshots so you can tell rooms apart later. They show on the plan.
        </p>
        <PhotoSlots room={room} onView={onViewPhoto} />
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-bold">Notes</h3>
        <textarea
          aria-label="Room notes"
          defaultValue={room.notes}
          key={room.id}
          // Saved on every keystroke (one undo step per edit) so closing the app mid-note loses nothing.
          onFocus={() => beginDrag()}
          onChange={(e) => {
            const v = e.target.value;
            preview((p) => ({
              ...p,
              rooms: p.rooms.map((r) => (r.id === room.id ? { ...r, notes: v } : r)),
            }));
          }}
          onBlur={() => commitDrag()}
          className="min-h-20 w-full rounded-xl border border-black/15 bg-white p-3 text-base"
          placeholder="Flooring, damage, outlets…"
        />
      </section>

      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${room.name}? You can undo this.`)) deleteRoom(room.id);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-red-800/30 text-base font-semibold text-red-800"
      >
        <Trash2 className="size-5" /> Delete room
      </button>
    </div>
  );
}
