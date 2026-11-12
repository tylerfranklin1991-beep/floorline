import { useBackClose } from "@/lib/field/back";
import { roomFlooring, ROLL_WIDTHS_FT } from "@/lib/field/materials";
import { formatLength, type FieldProperty } from "@/lib/field/model";
import { useField } from "@/lib/field/store";
import { autoPile, carpetPlans, normalizePile } from "@/lib/field/tseam";
import { HelpMark } from "./tutorials-ui";

/**
 * Carpet seam controls sitting on the sketch. Drag a dashed seam on the plan
 * to slide it; this panel changes roll width, pile direction, trim and the
 * pattern repeat, and the waste figure updates with the drawing.
 */
export function SeamDock({ property, onClose }: { property: FieldProperty; onClose: () => void }) {
  const change = useField((s) => s.change);
  const selectedId = useField((s) => s.selectedRoomId);
  useBackClose(true, onClose);
  const plans = carpetPlans(property);
  const focus = selectedId ? plans.find((p) => p.roomIds.includes(selectedId)) : undefined;
  const shown = focus ? [focus] : plans;
  const ids = shown.flatMap((p) => p.roomIds);
  const lead = property.rooms.find((r) => r.id === (ids[0] ?? ""));
  const flooring = lead ? roomFlooring(lead, property.job) : null;
  const linear = Math.round(shown.reduce((s, p) => s + p.layout.linearFt, 0) * 100) / 100;
  const yards = Math.round(shown.reduce((s, p) => s + p.layout.sqYd, 0) * 100) / 100;
  const ordered = shown.reduce((s, p) => s + p.layout.orderedSf, 0);
  const net = shown.reduce((s, p) => s + p.layout.netSf, 0);
  const waste = ordered > 0 ? Math.round(Math.max(0, ((ordered - net) / ordered) * 100) * 100) / 100 : 0;

  const patch = (partial: { rollWidthFt?: number; pileDeg?: number; trimIn?: number; patternRepeatIn?: number; seamOffsetFt?: number }) => {
    if (!ids.length) return;
    change((p) => ({
      ...p,
      rooms: p.rooms.map((r) => (ids.includes(r.id) ? { ...r, flooring: { ...r.flooring, ...partial } } : r)),
    }));
  };

  const runAuto = () => {
    const updates = new Map<string, 0 | 90>();
    for (const plan of shown) {
      const room = property.rooms.find((r) => r.id === plan.roomIds[0]);
      if (!room) continue;
      const f = roomFlooring(room, property.job);
      const pile = autoPile(plan.points, {
        units: property.units,
        rollWidthFt: f.rollWidthFt,
        trimIn: f.trimIn,
        patternRepeatIn: f.patternRepeatIn ?? 0,
        seamOffsetFt: f.seamOffsetFt,
        roomId: room.id,
        roomName: plan.title,
      });
      for (const id of plan.roomIds) updates.set(id, pile);
    }
    if (!updates.size) return;
    change((p) => ({
      ...p,
      rooms: p.rooms.map((r) =>
        updates.has(r.id) ? { ...r, flooring: { ...r.flooring, pileDeg: updates.get(r.id) } } : r,
      ),
    }));
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 max-h-[46%] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-white px-4 pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      role="dialog"
      aria-label="Carpet seams"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-xl font-bold">Carpet seams</h2>
        <HelpMark id="seams" />
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-11 items-center justify-center rounded-full bg-black/5 text-2xl">
          ×
        </button>
      </div>
      {plans.length === 0 ? (
        <p className="pb-3 text-base">No carpet rooms yet. Set a room to carpet, then come back for the cut list.</p>
      ) : (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-black/70">
            {focus ? focus.title : "All carpet"} · drag a dashed seam on the plan to slide it. Waste updates as it moves.
          </p>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-full bg-[#fff8ec] px-3 py-1">{linear} lin ft</span>
            <span className="rounded-full bg-[#fff8ec] px-3 py-1">{yards} sq yd</span>
            <span className="rounded-full bg-[#fff8ec] px-3 py-1">{waste}% waste</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLL_WIDTHS_FT.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => patch({ rollWidthFt: w })}
                className={`h-11 rounded-full px-4 text-sm font-semibold ${flooring?.rollWidthFt === w ? "bg-black text-white" : "bg-black/5"}`}
              >
                {w === 13.5 ? "13'6\"" : `${w}'`} roll
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={runAuto} className="h-11 rounded-full bg-[#b4561d] px-4 text-sm font-semibold text-white">
              Auto direction
            </button>
            <button
              type="button"
              onClick={() => flooring && patch({ pileDeg: normalizePile(flooring.pileDeg + 90) })}
              className="h-11 rounded-full bg-black/5 px-4 text-sm font-semibold"
            >
              Rotate pile
            </button>
            <span className="flex h-11 items-center text-sm">
              {normalizePile(flooring?.pileDeg ?? 0) === 90 ? "Pile runs up–down" : "Pile runs left–right"}
            </span>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">Trim each end</span>
            <input
              aria-label="Trim inches"
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={flooring?.trimIn ?? 3}
              onChange={(e) => patch({ trimIn: Number(e.target.value) })}
              className="h-11 w-24 rounded-xl border border-black/15 px-3"
            />
            <span>in</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">Pattern repeat</span>
            <input
              aria-label="Pattern repeat inches"
              type="number"
              min={0}
              max={240}
              step={1}
              value={flooring?.patternRepeatIn ?? 0}
              onChange={(e) => patch({ patternRepeatIn: Number(e.target.value) })}
              className="h-11 w-24 rounded-xl border border-black/15 px-3"
            />
            <span>in · 0 = every roll width</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">First seam</span>
            <input
              aria-label="Seam offset feet"
              type="range"
              min={0}
              max={flooring?.rollWidthFt ?? 12}
              step={0.25}
              value={flooring?.seamOffsetFt ?? 0}
              onChange={(e) => patch({ seamOffsetFt: Number(e.target.value) })}
              className="h-11 flex-1"
            />
            <span className="w-12 text-right">{flooring?.seamOffsetFt ?? 0}'</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={property.combineCarpet === true}
              onChange={(e) => change((p) => ({ ...p, combineCarpet: e.target.checked }))}
            />
            Lay touching rooms, halls and closets as one
          </label>
          <div>
            <p className="mb-1 text-sm font-bold">Cut list</p>
            <ul className="space-y-1 text-sm">
              {shown.flatMap((plan) =>
                plan.layout.pieces.map((piece) => (
                  <li key={`${plan.title}-${piece.n}`}>
                    #{piece.n} {formatLength(piece.widthFt, "ft")} × {formatLength(piece.cutLengthFt, "ft")} · {piece.roomName}
                    {piece.fill ? " · fill" : ""}
                  </li>
                )),
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
