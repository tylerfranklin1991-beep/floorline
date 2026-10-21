import { area, formatArea, type FieldProperty } from "./model";
import { renderPlanSvg } from "./render";

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "floorline-plan"
  );
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function planPngBlob(p: FieldProperty): Promise<Blob> {
  const svg = renderPlanSvg(p);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const maxEdge = 4096;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"),
  );
}

export async function exportPng(p: FieldProperty) {
  downloadBlob(`${slug(p.name)}.png`, await planPngBlob(p));
}

export function exportJson(p: FieldProperty) {
  downloadBlob(
    `${slug(p.name)}.floorline.json`,
    new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
  );
}

/** Share the PNG with the phone's share sheet (email, Drive, text) when supported. */
export async function sharePng(p: FieldProperty): Promise<boolean> {
  const blob = await planPngBlob(p);
  const file = new File([blob], `${slug(p.name)}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: p.name });
    return true;
  }
  downloadBlob(file.name, blob);
  return false;
}

/** Printable page (plan + room photo list). Use the print dialog's "Save as PDF". */
export function printPdf(p: FieldProperty) {
  const svg = renderPlanSvg(p);
  const rows = p.rooms
    .map(
      (r) =>
        `<div class="room"><h3>${escapeHtml(r.name)} <small>${formatArea(area(r.points), p.units)}</small></h3>${r.photos
          .map((ph) => `<img src="${ph.thumb}"/>`)
          .join("")}${r.notes ? `<p>${escapeHtml(r.notes)}</p>` : ""}</div>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(p.name)}</title><style>
body{font-family:Helvetica,Arial,sans-serif;margin:16px;color:#111}
.plan svg{width:100%;height:auto;max-height:95vh}
.rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;page-break-before:always}
.room img{width:48%;margin-right:2%;border-radius:4px}
h3{margin:4px 0} small{color:#666;font-weight:400}
@media print{button{display:none}}
</style></head><body><button onclick="print()" style="font-size:20px;padding:12px 20px">Save as PDF / Print</button>
<div class="plan">${svg}</div><div class="rooms">${rows}</div>
<script>setTimeout(()=>print(),400)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    downloadBlob(`${slug(p.name)}.html`, new Blob([html], { type: "text/html" }));
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
