import { ArrowLeft, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  formatLinear,
  formatYards,
  materials,
  MATERIAL_LABEL,
  TRANSITION_LABEL,
  type TransitionType,
} from "@/lib/field/materials";
import { formatArea, formatLength, type FieldProperty } from "@/lib/field/model";
import { sharePdf } from "@/lib/field/pdf";
import { useField } from "@/lib/field/store";
import { downloadBlob, slug } from "@/lib/field/export";
import { jobSettings } from "@/lib/field/job";
import { materialsCsv, materialsText, orderLines } from "@/lib/field/takeoff";
import { JobSettingsSheet } from "./job-settings";

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-black/[0.03] px-3 text-base">
      {label}
      <input
        type="checkbox"
        className="size-6"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Whole-property takeoff: area, carpet, trim and transitions, plus the PDF. */
export function MaterialsScreen({
  property,
  onClose,
}: {
  property: FieldProperty;
  onClose: () => void;
}) {
  const change = useField((s) => s.change);
  const updateOpening = useField((s) => s.updateOpening);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const m = materials(property);
  const order = orderLines(property, m);
  const j = jobSettings(property.job);
  const u = property.units;
  const roomName = (id: string | null) =>
    property.rooms.find((r) => r.id === id)?.name ?? "outside";
  const pdf = async () => {
    setBusy(true);
    try {
      await sharePdf(property);
      toast.success("PDF ready");
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") toast.error("PDF failed");
    } finally {
      setBusy(false);
    }
  };
  if (settings) return <JobSettingsSheet property={property} onClose={() => setSettings(false)} />;
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#f6f2e8]">
      <header
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/10 bg-white px-2 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          aria-label="Back to plan"
          onClick={onClose}
          className="flex size-12 items-center justify-center rounded-full"
        >
          <ArrowLeft />
        </button>
        <h1 className="flex-1 text-xl font-bold">Materials</h1>
        <button
          type="button"
          disabled={busy}
          onClick={pdf}
          className="flex h-12 items-center gap-2 rounded-full bg-[#b4561d] px-4 text-base font-semibold text-white disabled:opacity-50"
        >
          <FileText className="size-5" /> {busy ? "Building…" : "PDF"}
        </button>
      </header>
      <div
        className="mx-auto max-w-xl space-y-4 p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-sm uppercase tracking-wide text-black/50">Total floor area</div>
          <div className="text-4xl font-bold">{formatArea(m.area.total, u)}</div>
          {m.area.levels.length > 1 && (
            <ul className="mt-2 text-base">
              {m.area.levels.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span>{l.name}</span>
                  <b>{formatArea(l.area, u)}</b>
                </li>
              ))}
            </ul>
          )}
          {property.stairs.length > 0 && (
            <div className="mt-2 text-sm text-black/60">
              Stairs: {formatArea(m.area.stairsArea, u)}
              {m.area.steps ? ` · ${m.area.steps} steps` : ""}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="order-list">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">Order list</h2>
            <button
              type="button"
              onClick={() => setSettings(true)}
              className="h-11 rounded-full bg-black/5 px-4 text-base font-semibold"
            >
              Job settings
            </button>
          </div>
          {j.customer && <div className="text-sm text-black/60">For {j.customer}</div>}
          {order.length === 0 && <p className="text-black/60">Add rooms to see what to order.</p>}
          <ul className="divide-y divide-black/5">
            {order.map((l, i) => (
              <li key={i} className="py-2">
                <div className="flex justify-between gap-3 text-base">
                  <span>{l.item}</span>
                  <b className="text-right">{l.qty}</b>
                </div>
                {l.detail && <div className="text-xs text-black/55">{l.detail}</div>}
              </li>
            ))}
          </ul>
          {m.lvp.sqft > 0 && m.lvp.boxes == null && (
            <button
              type="button"
              onClick={() => setSettings(true)}
              className="mt-2 w-full rounded-xl bg-[#f3dcc3] p-2 text-sm font-semibold"
            >
              Set LVP sq ft per box to get a box count
            </button>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={async () =>
                (await copyText(materialsText(property)))
                  ? toast.success("Materials copied — paste into a text or email")
                  : toast.error("Couldn't copy")
              }
              className="h-12 rounded-xl bg-black text-base font-semibold text-white"
            >
              Copy as text
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  `${slug(property.name)}-materials.csv`,
                  new Blob([materialsCsv(property)], { type: "text/csv" }),
                ).catch(() => toast.error("CSV failed"))
              }
              className="h-12 rounded-xl bg-black/5 text-base font-semibold"
            >
              Save CSV
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <Toggle
            label="Include stairs in totals"
            on={property.includeStairs ?? false}
            onChange={(v) => change((p) => ({ ...p, includeStairs: v }))}
          />
          <Toggle
            label="Reuse carpet fills across rooms"
            on={property.reuseFills ?? false}
            onChange={(v) => change((p) => ({ ...p, reuseFills: v }))}
          />
          <Toggle
            label="Show seams on plan & PDF"
            on={property.showSeams !== false}
            onChange={(v) => change((p) => ({ ...p, showSeams: v }))}
          />
          <div className="flex rounded-xl bg-black/[0.03] p-1" role="radiogroup" aria-label="Units">
            {(["ft", "m"] as const).map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={u === x}
                onClick={() => useField.getState().setUnits(x)}
                className={`h-11 flex-1 rounded-lg text-base font-semibold ${u === x ? "bg-black text-white" : ""}`}
              >
                {x === "ft" ? "ft / in" : "Metric"}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">Carpet to order</h2>
          {m.carpet.length === 0 && <p className="text-black/60">No carpet rooms.</p>}
          {m.carpet.map((c) => (
            <div key={c.rollWidthFt} className="mb-3">
              <div className="flex justify-between text-base">
                <span>
                  {u === "ft"
                    ? `${c.rollWidthFt}' roll`
                    : `${(c.rollWidthFt * 0.3048).toFixed(2)} m roll`}
                </span>
                <b>
                  {formatLinear(c.linear, u)} · {formatYards(c.yards, u)}
                </b>
              </div>
              <ol className="mt-1 list-decimal pl-6 text-sm text-black/70">
                {c.pieces.map((pc, i) => (
                  <li key={i}>
                    {formatLength(pc.length, u)} long —{" "}
                    {pc.cuts
                      .map(
                        (ct) =>
                          `${roomName(ct.roomId)} ${formatLength(ct.width, u)}${ct.fill ? " fill" : ""}`,
                      )
                      .join(" + ")}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="text-xs text-black/50">
            Includes each room’s trim per end and waste %. Set per room in the room panel.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">Rooms</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-black/50">
              <tr>
                <th className="py-1">Room</th>
                <th>Floor</th>
                <th>Area</th>
                <th>Base</th>
                <th>Seams</th>
              </tr>
            </thead>
            <tbody>
              {m.rooms.map((r) => (
                <tr key={r.room.id} className="border-t border-black/5">
                  <td className="py-2 font-semibold">{r.room.name}</td>
                  <td>{MATERIAL_LABEL[r.flooring.material]}</td>
                  <td>{formatArea(r.area, u)}</td>
                  <td>{formatLinear(r.baseboard, u)}</td>
                  <td>{r.layout ? r.layout.seams.length : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">Trim</h2>
          <div className="flex justify-between text-base">
            <span>Baseboard</span>
            <b>{formatLinear(m.baseboard, u)}</b>
          </div>
          <div className="flex justify-between text-base">
            <span>Quarter round / shoe</span>
            <b>{m.quarterRound ? formatLinear(m.quarterRound, u) : "—"}</b>
          </div>
          <p className="text-xs text-black/50">
            Perimeter minus doorways and walls you un-ticked. No waste added.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">Transitions</h2>
          {m.transitions.length === 0 && (
            <p className="text-black/60">Add doors or doorways to rooms.</p>
          )}
          <ul className="space-y-2">
            {m.transitions.map((t) => (
              <li key={t.openingId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">
                  {roomName(t.roomId)} ↔ {roomName(t.otherRoomId)} · {formatLength(t.width, u)}
                </span>
                <select
                  aria-label="Transition type"
                  value={t.auto ? "auto" : t.type}
                  onChange={(e) => {
                    const v =
                      e.target.value === "auto" ? undefined : (e.target.value as TransitionType);
                    updateOpening(t.openingId, { transition: v });
                    if (t.twinOpeningId) updateOpening(t.twinOpeningId, { transition: v });
                  }}
                  className="h-11 rounded-xl border border-black/15 bg-white px-2 text-base"
                >
                  <option value="auto">Auto ({TRANSITION_LABEL[t.type]})</option>
                  {(Object.keys(TRANSITION_LABEL) as TransitionType[]).map((k) => (
                    <option key={k} value={k}>
                      {TRANSITION_LABEL[k]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {m.transitionTotals.length > 0 && (
            <div className="mt-3 border-t border-black/10 pt-2 text-base font-semibold">
              {m.transitionTotals.map((t) => (
                <div key={t.type} className="flex justify-between">
                  <span>
                    {t.count}× {TRANSITION_LABEL[t.type]}
                  </span>
                  <span>{formatLength(t.length, u)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
