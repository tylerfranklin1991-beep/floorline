import { ArrowDown, ArrowUp, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { rotateStairs, stairsLabel, type FieldProperty, type FieldStairs } from "@/lib/field/model";
import { useField } from "@/lib/field/store";
import { LengthInput } from "./room-panel";
import { jobSettings } from "@/lib/field/job";
import { formatLinear, stairCarpetFor } from "@/lib/field/materials";

const inch = (n: number) => {
  const f = Math.floor(n / 12);
  const i = Math.round((n - f * 12) * 4) / 4;
  return f ? `${f}' ${i}"` : `${i}"`;
};

function StairCarpetSection({ property, stairs }: { property: FieldProperty; stairs: FieldStairs }) {
  const updateStairs = useField((s) => s.updateStairs);
  const j = jobSettings(property.job);
  const style = stairs.style ?? j.stairStyle;
  const cut = stairCarpetFor(stairs, property.units, j);
  const on = stairs.carpet !== false;
  const num = (label: string, v: number, key: "treadIn" | "riserIn") => (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <input
        key={`${stairs.id}-${key}-${v}`}
        aria-label={label}
        type="number"
        inputMode="decimal"
        step={0.25}
        min={0}
        defaultValue={v}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0 && n !== v) updateStairs(stairs.id, { [key]: n });
        }}
        className="h-11 w-20 rounded-xl border border-black/15 bg-white px-2 text-base"
      />
    </label>
  );
  return (
    <section className="space-y-2" data-testid="stair-carpet">
      <h3 className="text-base font-bold">3 · Stair carpet</h3>
      <label className="flex min-h-12 items-center justify-between rounded-xl bg-black/[0.03] px-3 text-base">
        Carpet these stairs
        <input
          type="checkbox"
          className="size-6"
          checked={on}
          onChange={(e) => updateStairs(stairs.id, { carpet: e.target.checked })}
        />
      </label>
      {on && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["box", "waterfall"] as const).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={style === x}
                onClick={() => updateStairs(stairs.id, { style: x })}
                className={`h-12 rounded-xl text-base font-semibold ${style === x ? "bg-black text-white" : "bg-black/5"}`}
              >
                {x === "box" ? "Box / capped" : "Waterfall"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {num("Tread in", stairs.treadIn ?? j.treadIn, "treadIn")}
            {num("Riser in", stairs.riserIn ?? j.riserIn, "riserIn")}
          </div>
          {cut ? (
            <div className="rounded-xl bg-black/[0.03] p-2 text-sm" data-testid="stair-cut">
              <b>{cut.steps} cuts</b> of {inch(cut.pieceWidthIn)} × {inch(cut.pieceLengthIn)} (
              {style === "box" ? "tread + riser + 3\" wrap" : "tread + riser + 2\" wrap"}).{" "}
              {cut.perRow} per row across the {j.rollWidthFt}' roll → {cut.rows} row
              {cut.rows === 1 ? "" : "s"} = <b>{formatLinear(cut.linear, property.units)}</b> off the
              roll before waste.
            </div>
          ) : (
            <p className="text-sm text-black/50">Type the step count above to get the cut list.</p>
          )}
        </>
      )}
    </section>
  );
}

/** Bottom panel for the selected stairs: direction, size, typed step count, link. */
export function StairsPanel({
  property,
  stairs,
  onClose,
}: {
  property: FieldProperty;
  stairs: FieldStairs;
  onClose: () => void;
}) {
  const updateStairs = useField((s) => s.updateStairs);
  const deleteStairs = useField((s) => s.deleteStairs);
  const change = useField((s) => s.change);
  const u = property.units;
  const [steps, setSteps] = useState(stairs.steps ? String(stairs.steps) : "");
  useEffect(() => setSteps(stairs.steps ? String(stairs.steps) : ""), [stairs.id, stairs.steps]);
  const others = property.levels.filter((l) => l.id !== stairs.levelId);

  const commitSteps = () => {
    const t = steps.trim();
    if (!t) return stairs.steps !== null && updateStairs(stairs.id, { steps: null });
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      toast.error("Type a whole number of steps, like 14");
      setSteps(stairs.steps ? String(stairs.steps) : "");
      return;
    }
    if (n !== stairs.steps) updateStairs(stairs.id, { steps: n });
  };

  const big = "flex h-14 items-center justify-center gap-2 rounded-xl text-base font-semibold";

  return (
    <div className="space-y-5 p-4" data-testid="stairs-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm uppercase tracking-wide text-black/50">Stairs</div>
          <div className="text-2xl font-bold">{stairsLabel(stairs)}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close stairs panel"
          className="flex size-12 items-center justify-center rounded-full bg-black/5"
        >
          <X />
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="text-base font-bold">1 · Direction</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["up", "down"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={stairs.direction === d}
              onClick={() => updateStairs(stairs.id, { direction: d })}
              className={`${big} ${stairs.direction === d ? "bg-black text-white" : "bg-black/5"}`}
            >
              {d === "up" ? <ArrowUp className="size-5" /> : <ArrowDown className="size-5" />}
              {d === "up" ? "Up" : "Down"}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              change((p) => ({
                ...p,
                stairs: p.stairs.map((x) => (x.id === stairs.id ? rotateStairs(x) : x)),
              }))
            }
            className={`${big} bg-black/5`}
          >
            <RotateCw className="size-5" /> Turn
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-bold">2 · Size and steps</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-base">Width</span>
          <LengthInput
            label="Stairs width"
            value={stairs.width}
            units={u}
            onCommit={(n) => (updateStairs(stairs.id, { width: n }), true)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-base">Length</span>
          <LengthInput
            label="Stairs length"
            value={stairs.length}
            units={u}
            onCommit={(n) => (updateStairs(stairs.id, { length: n }), true)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-base">Steps</span>
          <input
            aria-label="Number of steps"
            inputMode="numeric"
            placeholder="optional"
            value={steps}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setSteps(e.target.value)}
            onBlur={commitSteps}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-12 w-28 rounded-xl border border-black/15 bg-white px-3 text-right text-lg font-semibold"
          />
          <span className="text-sm text-black/50">count them as you walk</span>
        </div>
      </section>

      <StairCarpetSection property={property} stairs={stairs} />

      <section className="space-y-2">
        <h3 className="text-base font-bold">4 · Leads to</h3>
        {others.length === 0 ? (
          <p className="text-base text-black/50">Add another level (top of the plan) to link it.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[{ id: null as string | null, name: "Not linked" }, ...others].map((l) => (
              <button
                key={l.id ?? "none"}
                type="button"
                aria-pressed={stairs.toLevelId === l.id}
                onClick={() => updateStairs(stairs.id, { toLevelId: l.id })}
                className={`h-12 rounded-full px-4 text-base font-semibold ${stairs.toLevelId === l.id ? "bg-black text-white" : "bg-black/5"}`}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={() => deleteStairs(stairs.id)}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-base font-semibold text-red-700"
      >
        <Trash2 className="size-5" /> Delete stairs
      </button>
    </div>
  );
}
