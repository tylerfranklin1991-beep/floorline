import {
  area,
  bbox,
  centroid,
  edges,
  formatArea,
  formatLength,
  openingSegment,
  type FieldProperty,
} from "./model.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type RenderOptions = { photos?: boolean; pxPerUnit?: number; title?: boolean };

/** Plan bounds with a margin for wall labels, in plan units. */
export function planFrame(p: FieldProperty, margin = 3) {
  if (p.rooms.length === 0)
    return { x: -margin, y: -margin, w: 20 + margin * 2, h: 16 + margin * 2 };
  const b = bbox(p.rooms.flatMap((r) => r.points));
  return { x: b.minX - margin, y: b.minY - margin, w: b.w + margin * 2, h: b.h + margin * 2 };
}

/** Standalone SVG of the plan (for PNG/PDF export). Pure string, no DOM. */
export function renderPlanSvg(p: FieldProperty, opts: RenderOptions = {}): string {
  const unit = p.units === "ft" ? 1 : 3.2808;
  const titleH = opts.title === false ? 0 : 3 / unit;
  const f = planFrame(p, 3 / unit);
  const px = opts.pxPerUnit ?? 40 * unit;
  const W = Math.round(f.w * px);
  const H = Math.round((f.h + titleH) * px);
  const font = 0.55 / unit;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${f.x} ${f.y - titleH} ${f.w} ${f.h + titleH}" font-family="Helvetica, Arial, sans-serif">`,
  );
  parts.push(
    `<rect x="${f.x}" y="${f.y - titleH}" width="${f.w}" height="${f.h + titleH}" fill="#ffffff"/>`,
  );
  if (opts.title !== false) {
    parts.push(
      `<text x="${f.x + 0.6 / unit}" y="${f.y - titleH + 1.3 / unit}" font-size="${1.0 / unit}" font-weight="700" fill="#111">${esc(p.name)}</text>`,
    );
    if (p.address)
      parts.push(
        `<text x="${f.x + 0.6 / unit}" y="${f.y - titleH + 2.3 / unit}" font-size="${0.6 / unit}" fill="#555">${esc(p.address)}</text>`,
      );
  }
  for (const room of p.rooms) {
    const d = room.points.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join(" ") + " Z";
    parts.push(
      `<path d="${d}" fill="#f4f1ea" stroke="#1b1b1b" stroke-width="${0.18 / unit}" stroke-linejoin="miter"/>`,
    );
  }
  for (const o of p.openings) {
    const room = p.rooms.find((r) => r.id === o.roomId);
    if (!room) continue;
    const seg = openingSegment(room, o);
    if (!seg) continue;
    const gap = `M${seg.a.x} ${seg.a.y} L${seg.b.x} ${seg.b.y}`;
    if (o.kind === "window") {
      parts.push(`<path d="${gap}" stroke="#ffffff" stroke-width="${0.22 / unit}"/>`);
      parts.push(`<path d="${gap}" stroke="#2f6fb3" stroke-width="${0.1 / unit}"/>`);
    } else {
      parts.push(`<path d="${gap}" stroke="#ffffff" stroke-width="${0.3 / unit}"/>`);
      if (o.kind === "door") {
        const w = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
        const tip = { x: seg.a.x + seg.inward.x * w, y: seg.a.y + seg.inward.y * w };
        parts.push(
          `<path d="M${seg.a.x} ${seg.a.y} L${tip.x} ${tip.y} A${w} ${w} 0 0 0 ${seg.b.x} ${seg.b.y}" fill="none" stroke="#1b1b1b" stroke-width="${0.06 / unit}"/>`,
        );
      }
    }
  }
  for (const room of p.rooms) {
    const c = centroid(room.points);
    parts.push(
      `<text x="${c.x}" y="${c.y}" font-size="${font * 1.3}" font-weight="700" text-anchor="middle" fill="#111">${esc(room.name)}</text>`,
    );
    parts.push(
      `<text x="${c.x}" y="${c.y + font * 1.4}" font-size="${font}" text-anchor="middle" fill="#555">${formatArea(area(room.points), p.units)}</text>`,
    );
    if (opts.photos !== false && room.photos.length) {
      const s = 2.2 / unit;
      room.photos.forEach((ph, i) => {
        const x = c.x - (room.photos.length * (s + 0.2 / unit)) / 2 + i * (s + 0.2 / unit);
        parts.push(
          `<image x="${x}" y="${c.y + font * 2}" width="${s}" height="${s * 0.75}" preserveAspectRatio="xMidYMid slice" href="${ph.thumb}" xlink:href="${ph.thumb}"/>`,
        );
      });
    }
    for (const e of edges(room.points)) {
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2;
      // Label just inside the wall.
      const L = e.length || 1;
      const nx = -(e.b.y - e.a.y) / L;
      const ny = (e.b.x - e.a.x) / L;
      const off = 0.7 / unit;
      const tx = mx + nx * off;
      const ty = my + ny * off + font * 0.35;
      const rot = e.horizontal ? 0 : -90;
      parts.push(
        `<text x="${tx}" y="${ty}" font-size="${font * 0.9}" text-anchor="middle" fill="#8a3b12" transform="rotate(${rot} ${tx} ${ty - font * 0.35})">${formatLength(e.length, p.units)}</text>`,
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}
