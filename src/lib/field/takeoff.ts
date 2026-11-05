/**
 * Installer take-off: one list of what to order / cut, shared by the Materials
 * screen, the PDF, and the copy-as-text / CSV export.
 */
import { jobSettings } from "./job.ts";
import {
  excludedArea,
  formatLinear,
  formatYards,
  MATERIAL_LABEL,
  materials,
  toSqFt,
  TRANSITION_LABEL,
  type Materials,
} from "./materials.ts";
import { formatLength, type FieldProperty } from "./model.ts";

export type OrderLine = { item: string; qty: string; detail: string };

const ft = (n: number) => `${Math.ceil(n * 10) / 10}`;
const sqft = (p: FieldProperty, a: number) =>
  p.units === "ft" ? `${ft(toSqFt(a, p.units))} sq ft` : `${(Math.ceil(a * 10) / 10).toFixed(1)} m²`;
const inches = (n: number) => {
  const f = Math.floor(n / 12);
  const i = Math.round((n - f * 12) * 4) / 4;
  return f ? `${f}' ${i}"` : `${i}"`;
};

/** The order list: LVP boxes, carpet per roll, pad, stairs, trim, transitions. */
export function orderLines(p: FieldProperty, m: Materials = materials(p)): OrderLine[] {
  const u = p.units;
  const j = jobSettings(p.job);
  const out: OrderLine[] = [];
  if (m.lvp.sqft > 0)
    out.push({
      item: `LVP${j.lvpProduct ? ` – ${j.lvpProduct}` : ""}`,
      qty:
        m.lvp.boxes != null
          ? `${m.lvp.boxes} boxes`
          : `${ft(m.lvp.withWaste)} sq ft`,
      detail: `${ft(m.lvp.sqft)} sq ft net + waste = ${ft(m.lvp.withWaste)} sq ft${
        m.lvp.boxes != null ? ` @ ${m.lvp.boxSqFt} sq ft/box` : " (set box coverage for a box count)"
      }`,
    });
  for (const c of m.carpet)
    out.push({
      item: `Carpet ${u === "ft" ? `${c.rollWidthFt}'` : `${(c.rollWidthFt * 0.3048).toFixed(2)} m`} roll${j.carpetProduct ? ` – ${j.carpetProduct}` : ""}`,
      qty: `${formatLinear(c.linear, u)} = ${formatYards(c.yards, u)}`,
      detail: `${c.pieces.length} room cut${c.pieces.length === 1 ? "" : "s"} ${formatLinear(c.roomsLinear, u)}${
        c.stairsLinear ? ` + stairs ${formatLinear(c.stairsLinear, u)}` : ""
      }, incl. waste`,
    });
  if (m.pad.sy > 0)
    out.push({
      item: `Pad / cushion${j.padProduct ? ` – ${j.padProduct}` : ""}`,
      qty: `${m.pad.sy.toFixed(1)} SY`,
      detail: `${ft(m.pad.sqft)} sq ft carpet area + ${j.padWastePct}%`,
    });
  for (const s of m.stairs)
    out.push({
      item: `Stairs (${s.style === "box" ? "box / capped" : "waterfall"})`,
      qty: `${s.steps} steps`,
      detail: `${s.steps} cuts ${inches(s.pieceWidthIn)} × ${inches(s.pieceLengthIn)}; ${s.perRow} per row across the roll, ${s.rows} row${s.rows === 1 ? "" : "s"} = ${formatLinear(s.linear, u)} off the roll before waste`,
    });
  if (m.baseboard > 0)
    out.push({ item: "Baseboard", qty: formatLinear(m.baseboard, u), detail: "doorways removed" });
  if (m.quarterRound > 0)
    out.push({ item: "Quarter round", qty: formatLinear(m.quarterRound, u), detail: "" });
  for (const t of m.transitionTotals)
    out.push({
      item: TRANSITION_LABEL[t.type],
      qty: `${t.count}`,
      detail: `${formatLength(t.length, u)} total width`,
    });
  return out;
}

/** Per-room rows for the cut sheet. */
export function roomRows(p: FieldProperty, m: Materials = materials(p)) {
  const u = p.units;
  return m.rooms.map((r) => {
    const f = r.flooring;
    const ex = excludedArea(r.room);
    const cuts =
      r.layout?.cuts.map(
        (c, i) =>
          `#${i + 1} ${formatLength(c.length, u)} × ${formatLength(c.width, u)}${c.fill ? " fill" : ""}${c.label ? ` (${c.label})` : ""}`,
      ) ?? [];
    return {
      name: r.room.name,
      level: p.levels.find((l) => l.id === r.room.levelId)?.name ?? "",
      material: MATERIAL_LABEL[f.material],
      area: sqft(p, r.area),
      excluded: ex > 0 ? sqft(p, ex) : "",
      waste: f.material === "none" ? "" : `${f.wastePct}%`,
      direction:
        f.material === "carpet"
          ? `pile runs ${["left-right", "top-bottom", "right-left", "bottom-top"][Math.round(f.pileDeg / 90) % 4]}`
          : f.material === "hard"
            ? `planks run ${Math.round(f.plankDeg / 90) % 2 ? "top-bottom" : "left-right"}`
            : "",
      seams: r.layout ? r.layout.seams.length : 0,
      seamOffset: f.material === "carpet" && f.seamOffsetFt ? `${f.seamOffsetFt}'` : "",
      cuts,
      baseboard: formatLinear(r.baseboard, u),
      quarterRound: r.quarterRound ? formatLinear(r.quarterRound, u) : "",
      areas: (r.room.areas ?? []).map(
        (a) => `${a.kind === "add" ? "+" : "-"} ${a.name} ${formatLength(a.w, u)} × ${formatLength(a.l, u)}`,
      ),
      notes: r.room.notes,
    };
  });
}

function header(p: FieldProperty): string[] {
  const j = jobSettings(p.job);
  return [
    p.name,
    j.customer && `Customer: ${j.customer}`,
    j.phone && `Phone: ${j.phone}`,
    j.email && `Email: ${j.email}`,
    p.address && `Address: ${p.address}`,
    j.installDate && `Install: ${j.installDate}`,
    j.jobNotes && `Notes: ${j.jobNotes}`,
  ].filter(Boolean) as string[];
}

/** Plain-text take-off for texting / pasting. */
export function materialsText(p: FieldProperty): string {
  const m = materials(p);
  const lines = [...header(p), "", "ORDER"];
  for (const l of orderLines(p, m)) lines.push(`- ${l.item}: ${l.qty}${l.detail ? ` (${l.detail})` : ""}`);
  lines.push("", "ROOMS");
  for (const r of roomRows(p, m)) {
    lines.push(
      `- ${r.name}${p.levels.length > 1 ? ` [${r.level}]` : ""}: ${r.material} ${r.area}${r.waste ? `, waste ${r.waste}` : ""}${r.direction ? `, ${r.direction}` : ""}`,
    );
    if (r.cuts.length) lines.push(`    cuts: ${r.cuts.join(", ")}; seams ${r.seams}${r.seamOffset ? ` (offset ${r.seamOffset})` : ""}`);
    if (r.areas.length) lines.push(`    areas: ${r.areas.join(", ")}`);
    if (r.notes) lines.push(`    note: ${r.notes}`);
  }
  return lines.join("\n");
}

const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

/** CSV take-off (order lines, then a room table). */
export function materialsCsv(p: FieldProperty): string {
  const m = materials(p);
  const rows: string[] = ["Item,Quantity,Detail"];
  for (const l of orderLines(p, m)) rows.push([l.item, l.qty, l.detail].map(q).join(","));
  rows.push("");
  rows.push("Room,Level,Material,Area,Excluded,Waste,Direction,Seams,Cuts,Baseboard,Quarter round,Notes");
  for (const r of roomRows(p, m))
    rows.push(
      [r.name, r.level, r.material, r.area, r.excluded, r.waste, r.direction, r.seams, r.cuts.join("; "), r.baseboard, r.quarterRound, r.notes]
        .map(q)
        .join(","),
    );
  return rows.join("\n");
}
