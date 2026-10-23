import { jsPDF } from "jspdf";
import { downloadBlob, slug } from "./export";
import {
  formatLinear,
  formatYards,
  materials,
  TRANSITION_LABEL,
  type Materials,
} from "./materials";
import { area, formatArea, formatLength, levelView, type FieldProperty } from "./model";
import { loadPhotoBlob } from "./photos";
import { jobSettings } from "./job";
import { orderLines, roomRows } from "./takeoff";
import { planFrame, renderPlanSvg } from "./render";

/** Standard drawing scales: [label, paper inches per plan unit]. */
const FT_SCALES: [string, number][] = [
  ['1/2" = 1\'-0"', 1 / 2],
  ['3/8" = 1\'-0"', 3 / 8],
  ['1/4" = 1\'-0"', 1 / 4],
  ['3/16" = 1\'-0"', 3 / 16],
  ['1/8" = 1\'-0"', 1 / 8],
  ['3/32" = 1\'-0"', 3 / 32],
  ['1/16" = 1\'-0"', 1 / 16],
  ['1/32" = 1\'-0"', 1 / 32],
];
const M_SCALES: [string, number][] = [50, 75, 100, 150, 200, 300, 500].map((n) => [
  `1:${n}`,
  1000 / n / 25.4,
]);

/** Largest standard scale that fits the plan in the box (inches). */
export function pickScale(
  wUnits: number,
  hUnits: number,
  boxW: number,
  boxH: number,
  metric: boolean,
) {
  const list = metric ? M_SCALES : FT_SCALES;
  return list.find(([, k]) => wUnits * k <= boxW && hUnits * k <= boxH) ?? list[list.length - 1];
}

async function svgToPng(svg: string, w: number, h: number): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/png");
}

async function blobToJpeg(b: Blob): Promise<{ url: string; w: number; h: number }> {
  const bmp = await createImageBitmap(b);
  const max = 1400;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/jpeg", 0.82), w: c.width, h: c.height };
}

export type PdfOptions = { seams?: boolean };

export async function buildPdf(full: FieldProperty, opts: PdfOptions = {}): Promise<Blob> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const PW = 8.5;
  const PH = 11;
  const M = 0.5;
  const u = full.units;
  const date = new Date().toLocaleDateString();
  const levels = full.levels.filter(
    (l, i) =>
      i === 0 ||
      full.rooms.some((r) => r.levelId === l.id) ||
      full.stairs.some((s) => s.levelId === l.id),
  );

  const titleBlock = (floor: string, extra = "") => {
    doc.setDrawColor(20);
    doc.setLineWidth(0.02);
    doc.rect(M, M, PW - 2 * M, 0.95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(full.name || "Floor plan", M + 0.15, M + 0.35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const j = jobSettings(full.job);
    const who = [j.customer, j.phone].filter(Boolean).join(" · ");
    const gps = full.location
      ? `GPS ${full.location.lat.toFixed(5)}, ${full.location.lng.toFixed(5)}`
      : "";
    const line2 = [who, full.address, gps].filter(Boolean).join(" — ");
    if (line2) doc.text(doc.splitTextToSize(line2, 5) as string[], M + 0.15, M + 0.58);
    doc.text(`Floor: ${floor}`, M + 0.15, M + 0.8);
    doc.text(`Date: ${date}`, PW - M - 0.15, M + 0.35, { align: "right" });
    if (extra) doc.text(extra, PW - M - 0.15, M + 0.58, { align: "right" });
    doc.text("Floorline", PW - M - 0.15, M + 0.8, { align: "right" });
  };

  const pages: Promise<{
    page: number;
    png: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>[] = [];
  levels.forEach((l, i) => {
    if (i > 0) doc.addPage();
    const view = levelView(full, l.id);
    const m = materials(full, l.id);
    const unit = u === "ft" ? 1 : 3.2808;
    const f = planFrame(view, 3 / unit);
    const boxW = PW - 2 * M;
    const boxH = 5.6;
    const [label, k] = pickScale(f.w, f.h, boxW, boxH, u === "m");
    const ppu = Math.max(8, k * 200); // ~200 dpi on paper
    const svg = renderPlanSvg(full, {
      levelId: l.id,
      photos: false,
      title: false,
      seams: opts.seams ?? full.showSeams !== false,
      scaleBar: true,
      pxPerUnit: ppu,
    });
    titleBlock(l.name, `Scale ${label}`);
    pages.push(
      svgToPng(svg, Math.round(f.w * ppu), Math.round(f.h * ppu)).then((png) => ({
        page: i + 1,
        png,
        x: M + (boxW - f.w * k) / 2,
        y: M + 1.1,
        w: f.w * k,
        h: f.h * k,
      })),
    );
    summaryTable(doc, m, full, M, M + 1.1 + f.h * k + 0.35, PW - 2 * M);
  });
  for (const pg of await Promise.all(pages)) {
    doc.setPage(pg.page);
    doc.addImage(pg.png, "PNG", pg.x, pg.y, pg.w, pg.h, undefined, "FAST");
  }

  // Whole-property materials when there are several floors.
  if (levels.length > 1) {
    doc.addPage();
    titleBlock("All floors", "Materials summary");
    summaryTable(doc, materials(full), full, M, M + 1.15, PW - 2 * M, true);
  }

  installerSheet(doc, full, titleBlock, levels.length > 1 ? "All floors" : levels[0].name);

  // Snapshots page.
  const stills = (r: (typeof full.rooms)[number]) => r.photos.filter((ph) => ph.kind !== "video");
  const withPhotos = full.rooms.filter((r) => stills(r).length);
  if (withPhotos.length) {
    doc.addPage();
    titleBlock(levels.length > 1 ? "All floors" : levels[0].name, "Room snapshots");
    let y = M + 1.2;
    const colW = (PW - 2 * M - 0.2) / 2;
    for (const r of withPhotos) {
      const list = stills(r);
      const imgs = await Promise.all(
        list.map(async (ph) => {
          const b = await loadPhotoBlob(ph.id).catch(() => undefined);
          if (b) return blobToJpeg(b).catch(() => ({ url: ph.thumb, w: 4, h: 3 }));
          return { url: ph.thumb, w: 4, h: 3 };
        }),
      );
      const videos = r.photos.length - list.length;
      const lvl =
        full.levels.length > 1
          ? ` · ${full.levels.find((x) => x.id === r.levelId)?.name ?? ""}`
          : "";
      let titled = false;
      // Two photos per row, wrapping; caption = time + GPS.
      for (let j = 0; j < imgs.length; j += 2) {
        const pair = imgs.slice(j, j + 2);
        const h = Math.max(...pair.map((im) => (colW * im.h) / im.w), 1);
        const imgH = Math.min(h, 3.2);
        const rowH = imgH + 0.3 + (titled ? 0 : 0.25);
        if (y + rowH > PH - M) {
          doc.addPage();
          y = M;
        }
        if (!titled) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(
            `${r.name}${lvl} — ${formatArea(area(r.points), u)}${videos ? ` (+${videos} video${videos > 1 ? "s" : ""} on phone)` : ""}`,
            M,
            y + 0.15,
          );
          y += 0.25;
          titled = true;
        }
        pair.forEach((im, k) => {
          const ph = list[j + k];
          const ih = Math.min((colW * im.h) / im.w, 3.2);
          const iw = Math.min((ih * im.w) / im.h, colW);
          const fmt = im.url.startsWith("data:image/png") ? "PNG" : "JPEG";
          const x = M + k * (colW + 0.2);
          doc.addImage(im.url, fmt, x, y, iw, ih);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          const cap = [
            new Date(ph.takenAt).toLocaleString(),
            ph.geo ? `GPS ${ph.geo.lat.toFixed(5)}, ${ph.geo.lng.toFixed(5)}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          doc.text(cap, x, y + ih + 0.14);
        });
        y += imgH + 0.4;
      }
    }
  }
  return doc.output("blob");
}

/** Installer page(s): job info, order list, per-room cut sheet, stairs, notes. */
function installerSheet(
  doc: jsPDF,
  p: FieldProperty,
  titleBlock: (floor: string, extra?: string) => void,
  floor: string,
) {
  const M = 0.5;
  const W = 7.5;
  const j = jobSettings(p.job);
  doc.addPage();
  titleBlock(floor, "Installer cut sheet");
  let y = M + 1.25;
  const need = (h: number) => {
    if (y + h > 10.5) {
      doc.addPage();
      y = M + 0.2;
    }
  };
  const write = (t: string, size = 10, bold = false, indent = 0) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(t, W - indent) as string[];
    need(lines.length * size * 0.0165 + 0.04);
    doc.text(lines, M + indent, y);
    y += lines.length * size * 0.0165 + 0.04;
  };
  const info = [
    j.customer && `Customer: ${j.customer}`,
    j.phone && `Phone: ${j.phone}`,
    j.email && `Email: ${j.email}`,
    p.address && `Address: ${p.address}`,
    j.installDate && `Install: ${j.installDate}`,
  ].filter(Boolean) as string[];
  if (info.length) write(info.join("   "), 10, true);
  if (j.jobNotes) write(`Job notes: ${j.jobNotes}`);
  y += 0.1;
  write("ORDER", 12, true);
  for (const l of orderLines(p)) {
    write(`[ ]  ${l.item}: ${l.qty}`, 10, true, 0.1);
    if (l.detail) write(l.detail, 8.5, false, 0.45);
  }
  y += 0.1;
  write("ROOMS", 12, true);
  doc.setLineWidth(0.01);
  for (const r of roomRows(p)) {
    need(0.6);
    doc.line(M, y - 0.12, M + W, y - 0.12);
    write(
      `${r.name}${p.levels.length > 1 ? ` (${r.level})` : ""} — ${r.material} ${r.area}${r.waste ? ` · waste ${r.waste}` : ""}${r.direction ? ` · ${r.direction}` : ""}`,
      10.5,
      true,
    );
    if (r.cuts.length)
      write(
        `Cuts: ${r.cuts.join(",  ")}   Seams: ${r.seams}${r.seamOffset ? ` (first seam ${r.seamOffset} from wall)` : ""}`,
        9,
        false,
        0.2,
      );
    if (r.areas.length) write(`Areas: ${r.areas.join(",  ")}${r.excluded ? ` (excluded ${r.excluded})` : ""}`, 9, false, 0.2);
    write(`Base: ${r.baseboard}${r.quarterRound ? `   Quarter round: ${r.quarterRound}` : ""}`, 9, false, 0.2);
    if (r.notes) write(`Note: ${r.notes}`, 9, false, 0.2);
    y += 0.08;
  }
}

function summaryTable(
  doc: jsPDF,
  m: Materials,
  p: FieldProperty,
  x: number,
  y0: number,
  w: number,
  showLevel = false,
) {
  const u = p.units;
  const cols = [0, 1.9, 2.9, 4.2, 5.3, 6.3].map((c) => x + (c * w) / 7.5);
  let y = y0;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  ["Room", u === "ft" ? "Sq ft" : "m²", "Floor", "Carpet cuts", "Baseboard", "Qtr round"].forEach(
    (h, i) => doc.text(h, cols[i], y),
  );
  doc.setLineWidth(0.01);
  doc.line(x, y + 0.05, x + w, y + 0.05);
  doc.setFont("helvetica", "normal");
  y += 0.2;
  for (const r of m.rooms) {
    const lvl = showLevel ? ` (${p.levels.find((l) => l.id === r.room.levelId)?.name ?? ""})` : "";
    const cuts = r.layout
      ? r.layout.cuts
          .map((c) => `${formatLength(c.length, u)}×${formatLength(c.width, u)}`)
          .join(", ")
      : "—";
    const row = [
      `${r.room.name}${lvl}`,
      formatArea(r.area, u),
      r.flooring.material === "carpet" ? "Carpet" : r.flooring.material === "hard" ? "LVP" : "—",
      cuts,
      formatLinear(r.baseboard, u),
      r.quarterRound ? formatLinear(r.quarterRound, u) : "—",
    ];
    const wrapped = doc.splitTextToSize(row[3], cols[4] - cols[3] - 0.05) as string[];
    row.forEach((t, i) => (i === 3 ? doc.text(wrapped, cols[i], y) : doc.text(t, cols[i], y)));
    y += 0.16 * Math.max(1, wrapped.length);
    if (y > 10.3) {
      doc.addPage();
      y = 0.6;
    }
  }
  doc.line(x, y - 0.1, x + w, y - 0.1);
  doc.setFont("helvetica", "bold");
  const lines: string[] = [
    `Total area: ${formatArea(m.area.total, u)}${p.includeStairs ? " (incl. stairs)" : ""}${m.area.steps ? ` · ${m.area.steps} steps` : ""}`,
    ...m.carpet.map(
      (c) =>
        `Carpet ${u === "ft" ? `${c.rollWidthFt}'` : `${(c.rollWidthFt * 0.3048).toFixed(2)} m`} roll: ${formatLinear(c.linear, u)} = ${formatYards(c.yards, u)} (${c.pieces.length} cuts, incl. waste)`,
    ),
    `Baseboard: ${formatLinear(m.baseboard, u)}${m.quarterRound ? ` · Quarter round: ${formatLinear(m.quarterRound, u)}` : ""}`,
    `Transitions: ${
      m.transitionTotals.length
        ? m.transitionTotals
            .map((t) => `${t.count}× ${TRANSITION_LABEL[t.type]} (${formatLength(t.length, u)})`)
            .join(", ")
        : "none"
    }`,
  ];
  doc.setFontSize(10);
  for (const l of lines) {
    y += 0.05;
    doc.text(doc.splitTextToSize(l, w) as string[], x, y);
    y += 0.18;
  }
}

/** Build the PDF and hand it to the share sheet (app) or download it (browser). */
export async function sharePdf(p: FieldProperty, opts: PdfOptions = {}) {
  const blob = await buildPdf(p, opts);
  await downloadBlob(`${slug(p.name)}.pdf`, new Blob([blob], { type: "application/pdf" }));
}
