import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { jobSettings } from "@/lib/field/job";
import {
  baseboard,
  boxesFor,
  carpetLayout,
  formatLinear,
  MATERIAL_LABEL,
  ROLL_WIDTHS_FT,
  roomArea,
  roomFlooring,
  seamPresets,
  toSqFt,
  wasteOverridden,
  type FloorMaterial,
  type RoomFlooring,
} from "@/lib/field/materials";
import {
  formatArea,
  formatLength,
  parseLength,
  uid,
  type FieldProperty,
  type FieldRoom,
  type RoomArea,
} from "@/lib/field/model";
import { useField } from "@/lib/field/store";

const chip = (on: boolean) =>
  `h-11 rounded-full px-4 text-base font-semibold ${on ? "bg-[#b4561d] text-white" : "bg-black/5"}`;

function NumField({
  label,
  value,
  onCommit,
  step = 1,
  width = "w-20",
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  width?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={label}
        className={`h-11 ${width} rounded-xl border border-black/15 bg-white px-2 text-base`}
        value={text ?? String(value)}
        onFocus={(e) => {
          setText(String(value));
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (text != null && text.trim() !== "" && Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
          setText(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Material, waste, LVP boxes / plank direction, carpet roll / pile / seams, trim. */
export function FlooringSection({ property, room }: { property: FieldProperty; room: FieldRoom }) {
  const updateRoom = useField((s) => s.updateRoom);
  const duplicateRoom = useField((s) => s.duplicateRoom);
  const u = property.units;
  const job = jobSettings(property.job);
  const fl = roomFlooring(room, property.job);
  const setFl = (patch: Partial<RoomFlooring>) =>
    updateRoom(room.id, { flooring: { ...(room.flooring ?? {}), ...patch } });
  const clearWaste = () => {
    const { wastePct: _w, ...rest } = room.flooring ?? {};
    updateRoom(room.id, { flooring: rest });
  };
  const lay = fl.material === "carpet" ? carpetLayout(room, u, fl) : null;
  const net = toSqFt(roomArea(room), u);
  const pre = fl.material === "carpet" ? seamPresets(room, fl, u) : null;
  const boxes = boxesFor(net * (1 + fl.wastePct / 100), job.lvpBoxSqFt);

  return (
    <section className="space-y-3" data-testid="flooring-section">
      <h3 className="text-base font-bold">Flooring &amp; trim</h3>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Floor material">
        {(["hard", "carpet", "none"] as FloorMaterial[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={fl.material === m}
            onClick={() => setFl({ material: m })}
            className={`h-12 rounded-xl text-base font-semibold ${fl.material === m ? "bg-black text-white" : "bg-black/5"}`}
          >
            {MATERIAL_LABEL[m]}
          </button>
        ))}
      </div>
      {fl.material !== "none" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <NumField
            label="Waste %"
            value={fl.wastePct}
            onCommit={(n) => setFl({ wastePct: Math.min(100, n) })}
          />
          {wasteOverridden(room) ? (
            <button type="button" onClick={clearWaste} className="h-11 rounded-full bg-black/5 px-3">
              Use job default ({fl.material === "carpet" ? job.carpetWastePct : job.lvpWastePct}%)
            </button>
          ) : (
            <span className="text-black/50">job default</span>
          )}
        </div>
      )}
      {fl.material === "hard" && (
        <div className="space-y-2 rounded-xl bg-black/[0.03] p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFl({ plankDeg: fl.plankDeg ? 0 : 90 })}
              className="h-11 rounded-full bg-black/5 px-4 text-base font-semibold"
              aria-label="Rotate plank direction"
            >
              Planks {fl.plankDeg ? "↕ up-down" : "↔ left-right"}
            </button>
          </div>
          <div data-testid="room-lvp">
            {Math.ceil(net * 10) / 10} sq ft + {fl.wastePct}% ={" "}
            <b>{Math.ceil(net * (1 + fl.wastePct / 100) * 10) / 10} sq ft</b>
            {boxes != null ? (
              <>
                {" "}
                · <b>{boxes} boxes</b> on their own (job total is rounded once)
              </>
            ) : (
              <span className="block text-xs text-black/50">
                Set box coverage in Job settings to get a box count.
              </span>
            )}
          </div>
        </div>
      )}
      {fl.material === "carpet" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Roll</span>
            {ROLL_WIDTHS_FT.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={fl.rollWidthFt === w}
                onClick={() => setFl({ rollWidthFt: w })}
                className={chip(fl.rollWidthFt === w)}
              >
                {u === "ft" ? `${w}'` : `${(w * 0.3048).toFixed(2)} m`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFl({ pileDeg: (fl.pileDeg + 90) % 360, seamOffsetFt: 0 })}
              className="h-11 rounded-full bg-black/5 px-4 text-base font-semibold"
              aria-label="Rotate pile direction"
            >
              Pile {["→", "↓", "←", "↑"][Math.round(fl.pileDeg / 90) % 4]} rotate
            </button>
          </div>
          <div className="space-y-2 rounded-xl bg-black/[0.03] p-2 text-sm" data-testid="seam-controls">
            <div className="font-semibold">
              Seams: first seam {fl.seamOffsetFt ? `${formatLength(u === "ft" ? fl.seamOffsetFt : fl.seamOffsetFt * 0.3048, u)} from the wall` : "a full roll width from the wall"}
            </div>
            <input
              type="range"
              aria-label="Seam position"
              className="w-full"
              min={0}
              max={fl.rollWidthFt}
              step={0.25}
              value={fl.seamOffsetFt}
              onChange={(e) => setFl({ seamOffsetFt: Number(e.target.value) })}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(fl.seamOffsetFt === pre!.start)} onClick={() => setFl({ seamOffsetFt: 0 })}>
                Full width at start
              </button>
              <button type="button" className={chip(fl.seamOffsetFt === pre!.centre && pre!.centre !== 0)} onClick={() => setFl({ seamOffsetFt: pre!.centre })}>
                Centre seams
              </button>
              <button type="button" className={chip(fl.seamOffsetFt === pre!.far && pre!.far !== 0)} onClick={() => setFl({ seamOffsetFt: pre!.far })}>
                Full width at far wall
              </button>
              <NumField
                label="Offset ft"
                step={0.25}
                value={fl.seamOffsetFt}
                onCommit={(n) => setFl({ seamOffsetFt: Math.min(fl.rollWidthFt, n) })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <NumField label="Trim/end (in)" value={fl.trimIn} onCommit={(n) => setFl({ trimIn: n })} />
          </div>
          {lay && (
            <ul className="rounded-xl bg-black/[0.03] p-2 text-sm" data-testid="room-cuts">
              {lay.cuts.map((c, i) => (
                <li key={i}>
                  Cut {i + 1}: {formatLength(c.length, u)} × {formatLength(c.width, u)}
                  {c.fill ? " (fill)" : ""}
                  {c.label ? ` – ${c.label}` : ""}
                </li>
              ))}
              <li className="font-semibold">
                {lay.seams.length} seam{lay.seams.length === 1 ? "" : "s"} ·{" "}
                {formatLinear(lay.length, u)} before waste
              </li>
            </ul>
          )}
        </>
      )}
      <div className="flex items-center justify-between rounded-xl bg-black/[0.03] p-2 text-sm">
        <span>
          Baseboard <b>{formatLinear(baseboard(property, room), u)}</b>
          <span className="block text-xs text-black/50">
            Untick “base” on a wall to skip it (cabinets)
          </span>
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={fl.quarterRound}
            onChange={(e) => setFl({ quarterRound: e.target.checked })}
          />
          Quarter round
        </label>
      </div>
      <button
        type="button"
        onClick={() => {
          duplicateRoom(room.id);
          toast.success(`Copied ${room.name}`);
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold"
      >
        <Copy className="size-5" /> Duplicate room
      </button>
    </section>
  );
}

const AREA_PRESETS: { name: string; kind: RoomArea["kind"] }[] = [
  { name: "Island", kind: "exclude" },
  { name: "Cabinets", kind: "exclude" },
  { name: "Hearth", kind: "exclude" },
  { name: "Closet", kind: "add" },
];

/** Exclusions (islands, cabinets, hearths) and add-on areas (closets, bays). */
export function AreasSection({ property, room }: { property: FieldProperty; room: FieldRoom }) {
  const updateRoom = useField((s) => s.updateRoom);
  const u = property.units;
  const [name, setName] = useState("Island");
  const [kind, setKind] = useState<RoomArea["kind"]>("exclude");
  const [w, setW] = useState("");
  const [l, setL] = useState("");
  const list = room.areas ?? [];
  const add = () => {
    const pw = parseLength(w, u);
    const pl = parseLength(l, u);
    if (!pw || !pl) return toast.error(`Type both sizes, like 6 and 3'6"`);
    updateRoom(room.id, {
      areas: [...list, { id: uid("area"), name: name.trim() || "Area", w: pw, l: pl, kind }],
    });
    setW("");
    setL("");
  };
  return (
    <section className="space-y-2" data-testid="areas-section">
      <h3 className="text-base font-bold">Exclusions &amp; add-ons</h3>
      <p className="text-sm text-black/55">
        Take out islands, cabinets, hearths; add a closet or bay you didn’t draw. Net:{" "}
        <b>{formatArea(roomArea(room), u)}</b>
      </p>
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl bg-black/[0.03] p-2 text-base">
          <span className="w-6 text-center font-bold">{a.kind === "add" ? "+" : "−"}</span>
          <span className="flex-1">
            {a.name} {formatLength(a.w, u)} × {formatLength(a.l, u)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${a.name}`}
            onClick={() => updateRoom(room.id, { areas: list.filter((x) => x.id !== a.id) })}
            className="flex size-11 items-center justify-center rounded-full"
          >
            <Trash2 className="size-5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {AREA_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className={chip(name === p.name)}
            onClick={() => {
              setName(p.name);
              setKind(p.kind);
            }}
          >
            {p.kind === "add" ? "+ " : "− "}
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle exclude or add"
          onClick={() => setKind(kind === "add" ? "exclude" : "add")}
          className="h-12 w-12 shrink-0 rounded-xl bg-black/5 text-xl font-bold"
        >
          {kind === "add" ? "+" : "−"}
        </button>
        <input
          aria-label="Area name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-2 text-base"
        />
        <input
          aria-label="Area width"
          inputMode="decimal"
          value={w}
          onChange={(e) => setW(e.target.value)}
          placeholder="W"
          className="h-12 w-16 rounded-xl border border-black/15 bg-white px-2 text-base"
        />
        <span>×</span>
        <input
          aria-label="Area length"
          inputMode="decimal"
          value={l}
          onChange={(e) => setL(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="L"
          className="h-12 w-16 rounded-xl border border-black/15 bg-white px-2 text-base"
        />
        <button
          type="button"
          aria-label="Add area"
          onClick={add}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black text-white"
        >
          <Plus />
        </button>
      </div>
    </section>
  );
}
