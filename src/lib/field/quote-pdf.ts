/** One-page (or more) customer quote. Shared through the Android share sheet. */
import { jsPDF } from "jspdf";
import { downloadBlob, slug } from "./export.ts";
import { planFrame, renderPlanSvg } from "./render.ts";
import type { FieldProperty } from "./model.ts";
import {
  lineAmount,
  money,
  quoteTotals,
  validThrough,
  type BusinessProfile,
  type SavedQuote,
} from "./quote.ts";

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

let bundledLogo: string | null = null;
async function defaultLogo(): Promise<string | null> {
  if (bundledLogo) return bundledLogo;
  try {
    const res = await fetch("/brand/scg-icon.png");
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    bundledLogo = `data:image/png;base64,${btoa(bin)}`;
    return bundledLogo;
  } catch {
    return null;
  }
}

function imageKind(url: string): "PNG" | "JPEG" | "WEBP" {
  if (url.startsWith("data:image/png")) return "PNG";
  if (url.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

export async function buildQuotePdf(
  p: FieldProperty,
  quote: SavedQuote,
  business: BusinessProfile,
): Promise<Blob> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const M = 0.5;
  const PW = 8.5;
  const right = PW - M;
  let y = M;

  const logo = business.logoDataUrl || (await defaultLogo());
  if (logo) {
    try {
      doc.addImage(logo, imageKind(logo), M, y, 0.7, 0.7);
    } catch {
      /* a bad upload should not block the quote */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(business.name || "Quote", M + (logo ? 0.85 : 0), y + 0.22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const contact = [business.phone, business.email, business.license && `Lic. ${business.license}`]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) doc.text(contact, M + (logo ? 0.85 : 0), y + 0.42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("QUOTE", right, y + 0.18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(quote.number, right, y + 0.38, { align: "right" });
  doc.text(quote.date, right, y + 0.54, { align: "right" });
  const until = validThrough(quote.date, quote.validDays);
  if (until) doc.text(`Valid through ${until}`, right, y + 0.7, { align: "right" });
  y += 0.95;

  if (quoteTotals(quote).subtotal === 0) {
    doc.setTextColor(154, 52, 18);
    doc.text("Unit prices are still $0. Fill in the price list before sending this quote.", M, y);
    doc.setTextColor(0);
    y += 0.22;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(quote.customer || "Customer", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (quote.address) doc.text(quote.address, M, y + 0.18);
  y += quote.address ? 0.4 : 0.25;

  try {
    const svg = renderPlanSvg(p, { title: false, photos: false, seams: true, scaleBar: false, pxPerUnit: 18 });
    const wm = /width="(\d+)"/.exec(svg);
    const hm = /height="(\d+)"/.exec(svg);
    const sw = Number(wm?.[1] ?? 800);
    const sh = Number(hm?.[1] ?? 500);
    const png = await svgToPng(svg, sw, sh);
    const frame = planFrame(p, 1);
    const maxW = right - M;
    const maxH = 2.35;
    const k = Math.min(maxW / Math.max(frame.w, 0.1), maxH / Math.max(frame.h, 0.1));
    const iw = Math.max(frame.w * k, 1.2);
    const ih = Math.max(frame.h * k, 0.8);
    const drawW = Math.min(maxW, (iw / ih) * Math.min(ih, maxH));
    const drawH = Math.min(maxH, drawW * (sh / sw));
    doc.addImage(png, "PNG", M, y, drawW, drawH);
    y += drawH + 0.2;
  } catch {
    /* plan image is optional */
  }

  const cols = [M, 4.7, 5.45, 6.15, 7.15];
  const headers = ["Description", "Qty", "Unit", "Price", "Amount"];
  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setFillColor(243, 220, 195);
    doc.rect(M, y - 0.14, right - M, 0.22, "F");
    headers.forEach((h, i) => doc.text(h, cols[i], y));
    y += 0.16;
  };
  drawHeader();
  const rows = quote.lines.filter((l) => l.qty > 0);
  doc.setFont("helvetica", "normal");
  for (const l of rows) {
    const label = doc.splitTextToSize(l.label, cols[1] - cols[0] - 0.08) as string[];
    const rowH = Math.max(0.18, label.length * 0.14);
    if (y + rowH > 10.3) {
      doc.addPage();
      y = M + 0.2;
      drawHeader();
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(8);
    doc.text(label, cols[0], y);
    doc.text(String(l.qty), cols[1], y);
    doc.text(l.unit, cols[2], y);
    doc.text(money(l.price), cols[3], y);
    doc.text(money(lineAmount(l)), cols[4], y);
    y += rowH;
  }

  const t = quoteTotals(quote);
  y += 0.08;
  const totals: [string, string][] = [
    ["Subtotal", money(t.subtotal)],
    ...(t.markup ? ([[`Markup ${quote.markupPct}%`, money(t.markup)]] as [string, string][]) : []),
    ...(t.discount ? ([[`Discount`, money(-t.discount)]] as [string, string][]) : []),
    ...(t.tax ? ([[`Tax ${quote.taxPct}%`, money(t.tax)]] as [string, string][]) : []),
    ["Total", money(t.total)],
    ...(t.deposit ? ([[`Deposit ${quote.depositPct}%`, money(t.deposit)], ["Balance", money(t.balance)]] as [string, string][]) : []),
  ];
  for (const [label, value] of totals) {
    if (y > 10.4) {
      doc.addPage();
      y = M + 0.2;
    }
    const last = label === "Total" || label === "Balance";
    doc.setFont("helvetica", last ? "bold" : "normal");
    doc.setFontSize(last ? 11 : 9);
    doc.text(label, 5.3, y);
    doc.text(value, right, y, { align: "right" });
    y += last ? 0.22 : 0.16;
  }

  y += 0.12;
  if (quote.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const notes = doc.splitTextToSize(quote.notes, right - M) as string[];
    if (y + notes.length * 0.14 > 10.2) {
      doc.addPage();
      y = M + 0.2;
    }
    doc.text(notes, M, y);
    y += notes.length * 0.14 + 0.25;
  }
  if (y > 9.8) {
    doc.addPage();
    y = M + 0.3;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Accepted by: ${quote.signature || "______________________________"}`, M, y + 0.2);
  doc.text("Date: ________________", 5.2, y + 0.2);
  doc.line(M, y + 0.28, 4.6, y + 0.28);

  return doc.output("blob");
}

export async function shareQuotePdf(p: FieldProperty, quote: SavedQuote, business: BusinessProfile) {
  const blob = await buildQuotePdf(p, quote, business);
  const name = `${slug(p.name)}-${quote.number}.pdf`;
  await downloadBlob(name, new Blob([blob], { type: "application/pdf" }));
}
