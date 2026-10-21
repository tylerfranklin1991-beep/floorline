import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { jobSettings, type JobSettings } from "@/lib/field/job";
import { ROLL_WIDTHS_FT } from "@/lib/field/materials";
import type { FieldProperty } from "@/lib/field/model";
import { useField } from "@/lib/field/store";

function Text({
  label,
  value,
  onCommit,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  type?: string;
  inputMode?: "decimal" | "tel" | "email" | "text";
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        aria-label={label}
        type={type}
        inputMode={inputMode}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base"
      />
    </label>
  );
}

function Num({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        aria-label={label}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={v}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (v.trim() !== "" && Number.isFinite(n) && n >= 0) {
            if (n !== value) onCommit(n);
          } else setV(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base"
      />
    </label>
  );
}

const seg = (on: boolean) =>
  `h-11 flex-1 rounded-lg text-base font-semibold ${on ? "bg-black text-white" : ""}`;

/** Per-job settings: customer info + LVP / carpet / pad / stair defaults. */
export function JobSettingsSheet({
  property,
  onClose,
}: {
  property: FieldProperty;
  onClose: () => void;
}) {
  const updateJob = useField((s) => s.updateJob);
  const change = useField((s) => s.change);
  const j = jobSettings(property.job);
  const set = (patch: Partial<JobSettings>) => updateJob(patch);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f6f2e8]" data-testid="job-settings">
      <header
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <h1 className="flex-1 text-xl font-bold">Job settings</h1>
        <button
          type="button"
          aria-label="Close job settings"
          onClick={onClose}
          className="flex size-12 items-center justify-center rounded-full bg-black/5"
        >
          <X />
        </button>
      </header>
      <div className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">Customer &amp; job</h2>
          <Text
            label="Job name"
            value={property.name}
            onCommit={(v) => change((p) => ({ ...p, name: v.trim() || p.name }))}
          />
          <Text label="Customer" value={j.customer} onCommit={(v) => set({ customer: v })} />
          <Text
            label="Phone"
            type="tel"
            inputMode="tel"
            value={j.phone}
            onCommit={(v) => set({ phone: v })}
          />
          <Text
            label="Email"
            type="email"
            inputMode="email"
            value={j.email}
            onCommit={(v) => set({ email: v })}
          />
          <Text
            label="Address"
            value={property.address}
            onCommit={(v) => change((p) => ({ ...p, address: v }))}
          />
          <Text
            label="Install date / time"
            value={j.installDate}
            onCommit={(v) => set({ installDate: v })}
          />
          <Text label="Job notes" value={j.jobNotes} onCommit={(v) => set({ jobNotes: v })} />
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">New rooms default to</h2>
          <div className="flex rounded-xl bg-black/[0.03] p-1" role="radiogroup" aria-label="Default material">
            {(["hard", "carpet"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={j.defaultMaterial === m}
                onClick={() => set({ defaultMaterial: m })}
                className={seg(j.defaultMaterial === m)}
              >
                {m === "hard" ? "LVP" : "Carpet"}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">LVP</h2>
          <Text label="Product" value={j.lvpProduct} onCommit={(v) => set({ lvpProduct: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Num label="Waste %" value={j.lvpWastePct} onCommit={(n) => set({ lvpWastePct: Math.min(100, n) })} />
            <Num
              label="Sq ft per box"
              step={0.01}
              value={j.lvpBoxSqFt}
              onCommit={(n) => set({ lvpBoxSqFt: n })}
            />
          </div>
          <p className="text-xs text-black/50">Boxes are rounded up for the whole job.</p>
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">Carpet</h2>
          <Text label="Product" value={j.carpetProduct} onCommit={(v) => set({ carpetProduct: v })} />
          <div className="space-y-1">
            <span className="text-sm font-semibold">Roll width</span>
            <div className="flex rounded-xl bg-black/[0.03] p-1">
              {ROLL_WIDTHS_FT.map((w) => (
                <button key={w} type="button" onClick={() => set({ rollWidthFt: w })} className={seg(j.rollWidthFt === w)}>
                  {w}'
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Waste % (job)"
              value={j.carpetWastePct}
              onCommit={(n) => set({ carpetWastePct: Math.min(100, n) })}
            />
            <Num label="Trim per end (in)" value={j.trimIn} onCommit={(n) => set({ trimIn: n })} />
          </div>
          <p className="text-xs text-black/50">
            Each room can override waste in its room panel.
          </p>
          <label className="flex min-h-12 items-center justify-between rounded-xl bg-black/[0.03] px-3 text-base">
            Pad / cushion
            <input
              type="checkbox"
              className="size-6"
              checked={j.pad}
              onChange={(e) => set({ pad: e.target.checked })}
            />
          </label>
          {j.pad && (
            <div className="grid grid-cols-2 gap-3">
              <Text label="Pad product" value={j.padProduct} onCommit={(v) => set({ padProduct: v })} />
              <Num label="Pad waste %" value={j.padWastePct} onCommit={(n) => set({ padWastePct: Math.min(100, n) })} />
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">Stairs (carpet)</h2>
          <div className="flex rounded-xl bg-black/[0.03] p-1" role="radiogroup" aria-label="Stair style">
            {(["box", "waterfall"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={j.stairStyle === s}
                onClick={() => set({ stairStyle: s })}
                className={seg(j.stairStyle === s)}
              >
                {s === "box" ? "Box / capped (+3\")" : "Waterfall (+2\")"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Tread (in)" step={0.25} value={j.treadIn} onCommit={(n) => set({ treadIn: n })} />
            <Num label="Riser (in)" step={0.25} value={j.riserIn} onCommit={(n) => set({ riserIn: n })} />
          </div>
          <p className="text-xs text-black/50">
            Add stairs on the plan and type the step count. These settings are remembered for your next job.
          </p>
        </section>
      </div>
    </div>
  );
}
