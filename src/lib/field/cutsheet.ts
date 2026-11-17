/** Installer page: numbered carpet cuts and a seam diagram for each room. */
import type { jsPDF } from "jspdf";
import { bbox, formatLength, type FieldProperty, type Pt } from "./model.ts";
import { carpetPlans, type TseamLayout } from "./tseam.ts";

function mapBox(points: Pt[], x: number, y: number, w: number, h: number) {
  const b = bbox(points);
  const bw = Math.max(b.maxX - b.minX, 0.01);
  const bh = Math.max(b.maxY - b.minY, 0.01);
  const k = Math.min(w / bw, h / bh);
  const ox = x + (w - bw * k) / 2;
  const oy = y + (h - bh * k) / 2;
  return {
    X: (px: number) => ox + (px - b.minX) * k,
    Y: (py: number) => oy + (py - b.minY) * k,
  };
}

function drawDiagram(doc: jsPDF, points: Pt[], layout: TseamLayout, x: number, y: number, w: number, h: number) {
  const { X, Y } = mapBox(points, x, y, w, h);
  doc.setDrawColor(20);
  doc.setLineWidth(0.012);
  doc.setLineDashPattern([], 0);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    doc.line(X(a.x), Y(a.y), X(b.x), Y(b.y));
  }
  for (const m of layout.marks) {
    doc.setDrawColor(m.kind === "t" ? 154 : 208, m.kind === "t" ? 52 : 52, m.kind === "t" ? 18 : 44);
    doc.setLineWidth(m.kind === "t" ? 0.02 : 0.01);
    doc.setLineDashPattern(m.kind === "t" ? [] : [0.05, 0.04], 0);
    doc.line(X(m.a.x), Y(m.a.y), X(m.b.x), Y(m.b.y));
  }
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(154, 52, 18);
  for (const piece of layout.pieces) {
    if (piece.corners.length < 3) continue;
    const cx = piece.corners.reduce((s, q) => s + q.x, 0) / piece.corners.length;
    const cy = piece.corners.reduce((s, q) => s + q.y, 0) / piece.corners.length;
    doc.text(String(piece.n), X(cx), Y(cy), { align: "center", baseline: "middle" });
  }
  doc.setTextColor(0);
}

/** Extra pages on the job PDF. No-op when the job has no carpet. */
export function appendCutSheet(doc: jsPDF, p: FieldProperty) {
  const plans = carpetPlans(p).filter((pl) => pl.layout.pieces.length);
  if (!plans.length) return;
  const M = 0.5;
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text("Carpet cut sheet", M, M + 0.15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Piece numbers match the seam diagram. Arrows on the plan show the pile. T-seams are the solid cross joints.", M, M + 0.4);
  let y = M + 0.6;
  for (const plan of plans) {
    const lay = plan.layout;
    const block = 2.3 + Math.ceil(lay.pieces.length / 2) * 0.2;
    if (y + block > 10.4) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(plan.title, M, y + 0.05);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const pile = lay.pileDeg === 90 ? "pile runs up–down" : "pile runs left–right";
    doc.text(
      `${lay.linearFt} lin ft · ${lay.sqYd} sq yd · ${lay.wastePct}% waste · ${pile}`,
      M,
      y + 0.24,
    );
    drawDiagram(doc, plan.points, lay, 5.15, y, 2.5, 2.05);
    let row = y + 0.5;
    doc.setFontSize(8.5);
    for (const piece of lay.pieces) {
      const text = `#${piece.n}   ${formatLength(piece.widthFt, "ft")} × ${formatLength(piece.cutLengthFt, "ft")}   ${piece.roomName}${piece.fill ? "   fill" : ""}`;
      doc.text(text, M, row);
      row += 0.18;
    }
    y = Math.max(row, y + 2.2) + 0.25;
  }
}
