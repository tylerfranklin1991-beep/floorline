/**
 * "Auto from sketch": turn OCR text lines + detected pencil lines from a photo
 * of a hand sketch into proposed rectangular rooms. Pure functions (unit tested).
 */

export type Box = { x: number; y: number; w: number; h: number };
export type TextLine = Box & { text: string; block?: number };
export type Dim = { a: number; b: number; raw: string };

/** Normalise OCR quirks: curly quotes, ×, "ft", O→0 / l→1 next to digits. */
export function normalizeDimText(s: string): string {
  return s
    .replace(/[’‘`´′]/g, "'")
    .replace(/[”“″]/g, '"')
    .replace(/''/g, '"')
    .replace(/[×✕*]/g, "x")
    .replace(/(\d)\s*ft\.?/gi, "$1'")
    .replace(/(\d)\s*in\.?/gi, '$1"')
    .replace(/(?<=[\d'])[oO](?=[\d'"\sxX]|$)/g, "0")
    .replace(/(?<=\d)[lI|](?=[\d'"\sxX]|$)/g, "1")
    .replace(/(?<=^|[\s'x])[oO](?=\d)/g, "0")
    .replace(/(?<=^|[\s'x])[lI|](?=\d)/g, "1");
}

// One length: 12'8, 12'8", 12', 12-8, 12.5, 12 8 (apostrophe lost), 12
const LEN = String.raw`\d{1,3}(?:\s*'\s*\d{1,2}(?:\s*")?|\s*'|\s*-\s*\d{1,2}|\.\d+|\s+\d{1,2}(?=\s*[xX]))?`;
const DIM_RE = new RegExp(`(${LEN})\\s*[xX]\\s*(${LEN})`);

/** Feet from one side, e.g. 12'8 → 12.667. null if not a sensible length. */
export function parseFeet(s: string): number | null {
  const t = s.trim().replace(/"$/, "");
  let m = /^(\d{1,3})\s*(?:'|-|\s)\s*(\d{1,2})$/.exec(t);
  if (m) {
    const ft = Number(m[1]);
    const inch = Number(m[2]);
    if (inch >= 12) return null;
    return ft + inch / 12;
  }
  m = /^(\d{1,3}(?:\.\d+)?)\s*'?$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** Find "W x L" in a text line. Lengths in feet. */
export function parseDimension(text: string): Dim | null {
  const n = normalizeDimText(text);
  const m = DIM_RE.exec(n);
  if (!m) return null;
  const a = parseFeet(m[1]);
  const b = parseFeet(m[2]);
  if (!a || !b || a < 1 || b < 1 || a > 200 || b > 200) return null;
  return { a, b, raw: m[0].trim() };
}

const NAME_MAP: [RegExp, string][] = [
  [/^m\.?\s*b\.?\s*r\.?$|master|primary|^mbr$/i, "Primary bed"],
  [/^m\.?\s*b\.?\s*a\.?$|^m\.?\s*bath/i, "Primary bath"],
  [/^b\.?\s*r\.?\s*\d*$|bed\s*room|^bdrm?/i, "Bedroom"],
  [/^w\.?\s*i\.?\s*c\.?$|walk.?in/i, "WIC"],
  [/clo?s(et|t)?|^cl\.?$/i, "Closet"],
  [/^l\.?\s*r\.?$|living|^liv/i, "Living"],
  [/^d\.?\s*r\.?$|dining|^din/i, "Dining"],
  [/^k(it)?(chen)?\.?$|kitchen/i, "Kitchen"],
  [/^f\.?\s*r\.?$|family/i, "Family room"],
  [/bath|^ba\.?$/i, "Bath"],
  [/hall/i, "Hall"],
  [/laund|^lau/i, "Laundry"],
  [/office|^den$/i, "Office"],
  [/entry|foyer/i, "Entry"],
  [/pantry/i, "Pantry"],
  [/garage/i, "Garage"],
];

/** "M.B.R." → "Primary bed"; unknown labels keep their own text (tidied). */
export function roomNameFromLabel(label: string): string {
  const t = label.trim().replace(/\s+/g, " ");
  for (const [re, name] of NAME_MAP) if (re.test(t)) {
    const num = /\b(\d)\b/.exec(t)?.[1];
    return name === "Bedroom" && num ? `Bedroom ${num}` : name;
  }
  return t.length <= 2 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1).toLowerCase();
}

function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 24) return false;
  if (parseDimension(t)) return false;
  return /[a-zA-Z]{2,}|[a-zA-Z]\.[a-zA-Z]/.test(t);
}

/* ------------------------------------------------------------- lines */

export type Seg = { o: "h" | "v"; at: number; from: number; to: number };

/**
 * Long dark straight strokes in a binarised image (1 = ink), row/column runs
 * with small gaps bridged, then neighbouring runs merged into one line.
 */
export function findLines(ink: Uint8Array, w: number, h: number, minLen = Math.max(w, h) * 0.08): Seg[] {
  const out: Seg[] = [];
  const scan = (o: "h" | "v") => {
    const n = o === "h" ? h : w;
    const len = o === "h" ? w : h;
    const raw: Seg[] = [];
    for (let i = 0; i < n; i++) {
      let start = -1;
      let gap = 0;
      for (let j = 0; j <= len; j++) {
        const on = j < len && ink[o === "h" ? i * w + j : j * w + i] === 1;
        if (on) {
          if (start < 0) start = j;
          gap = 0;
        } else if (start >= 0) {
          gap++;
          if (gap > 4 || j === len) {
            const end = j - gap;
            if (end - start >= minLen) raw.push({ o, at: i, from: start, to: end });
            start = -1;
            gap = 0;
          }
        }
      }
    }
    // Merge runs on adjacent rows/cols that overlap (a pencil line is several px thick).
    const merged: (Seg & { n: number; last: number })[] = [];
    for (const s of raw) {
      const m = merged.find(
        (x) => s.at - x.last <= 3 && s.from < x.to && s.to > x.from,
      );
      if (m) {
        m.at = (m.at * m.n + s.at) / (m.n + 1);
        m.n++;
        m.last = s.at;
        m.from = Math.min(m.from, s.from);
        m.to = Math.max(m.to, s.to);
      } else merged.push({ ...s, n: 1, last: s.at });
    }
    for (const m of merged) out.push({ o: m.o, at: m.at, from: m.from, to: m.to });
  };
  scan("h");
  scan("v");
  return out;
}

/** Adaptive threshold (local mean) of greyscale → ink mask. */
export function binarize(gray: Uint8Array, w: number, h: number, win = 15, offset = 18): Uint8Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - win);
    const y1 = Math.min(h, y + win + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - win);
      const x1 = Math.min(w, x + win + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = gray[y * w + x] < mean - offset ? 1 : 0;
    }
  }
  return out;
}

/** Smallest box of lines around a point (nearest line left/right/above/below that spans it). */
export function enclosingBox(segs: Seg[], px: number, py: number, slack = 6): Box | null {
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const s of segs) {
    if (s.o === "v" && py >= s.from - slack && py <= s.to + slack) {
      if (s.at < px) left = Math.max(left, s.at);
      else right = Math.min(right, s.at);
    } else if (s.o === "h" && px >= s.from - slack && px <= s.to + slack) {
      if (s.at < py) top = Math.max(top, s.at);
      else bottom = Math.min(bottom, s.at);
    }
  }
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/* --------------------------------------------------------- proposals */

export type Proposal = {
  name: string;
  /** Feet. w = left-right on the sketch, l = up-down. 0 = unknown (user types it). */
  w: number;
  l: number;
  /** Top-left on the plan, feet. */
  x: number;
  y: number;
  /** Where it is on the sketch image (px), for the review overlay. */
  box: Box;
  dimText?: string;
  fromBox: boolean;
};

export type SketchResult = {
  proposals: Proposal[];
  /** Feet per sketch pixel (used to line the sketch up as a trace background). */
  ftPerPx: number;
  /** Text that wasn't used, for the user to see. */
  leftover: string[];
  quality: "good" | "partial" | "poor";
  /** Feet subtracted to move the top-left room to 0,0 (sketch px * ftPerPx space). */
  offset: { x: number; y: number };
};

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/**
 * Pair each dimension with its room box (if lines were found) and a nearby
 * label, then place rooms relative to each other at a common sketch scale.
 */
export function buildProposals(
  lines: TextLine[],
  segs: Seg[],
  imgW: number,
): SketchResult {
  const dims = lines
    .map((l) => ({ line: l, dim: parseDimension(l.text) }))
    .filter((d): d is { line: TextLine; dim: Dim } => Boolean(d.dim));
  const labels = lines.filter((l) => looksLikeLabel(l.text));
  const used = new Set<TextLine>();

  type Raw = { dim: Dim; text: TextLine; box: Box | null };
  const raws: Raw[] = dims.map(({ line, dim }) => {
    const c = center(line);
    let box = enclosingBox(segs, c.x, c.y);
    // A box must be bigger than the text inside it and not the whole page.
    if (box && (box.w < line.w * 0.9 || box.h < line.h * 1.5 || box.w > imgW * 0.98)) box = null;
    used.add(line);
    return { dim, text: line, box };
  });

  // Orient: the longer measurement goes along the longer side of the box.
  const sized = raws.map((r) => {
    let w = r.dim.a;
    let l = r.dim.b;
    if (r.box && (r.box.w >= r.box.h) !== (w >= l)) [w, l] = [l, w];
    return { ...r, w, l };
  });

  const scales = sized
    .filter((r) => r.box)
    .flatMap((r) => [r.w / r.box!.w, r.l / r.box!.h]);
  // No boxes: guess from the sizes vs. spacing of the text (rooms ~ 6 text heights apart).
  let ftPerPx = median(scales);
  if (!Number.isFinite(ftPerPx) || ftPerPx <= 0) {
    const avgFt = median(sized.map((r) => (r.w + r.l) / 2));
    const avgTextW = median(sized.map((r) => r.text.w));
    ftPerPx = Number.isFinite(avgFt) && avgTextW > 0 ? avgFt / (avgTextW * 2.2) : 40 / imgW;
  }

  const proposals: Proposal[] = sized.map((r) => {
    const tc = center(r.text);
    const region = r.box ?? {
      x: tc.x - r.w / ftPerPx / 2,
      y: tc.y - r.l / ftPerPx / 2,
      w: r.w / ftPerPx,
      h: r.l / ftPerPx,
    };
    // Label: inside the box, else the closest label line just above / around the dimension.
    const inside = labels.filter((lb) => {
      if (used.has(lb)) return false;
      const c = center(lb);
      return c.x >= region.x && c.x <= region.x + region.w && c.y >= region.y && c.y <= region.y + region.h;
    });
    const pick = (inside.length ? inside : labels.filter((lb) => !used.has(lb)))
      .map((lb) => ({ lb, d: Math.hypot(center(lb).x - tc.x, (center(lb).y - tc.y) * 1.5) }))
      .filter((x) => inside.length || x.d < r.text.w * 2.5)
      .sort((a, b) => a.d - b.d)[0]?.lb;
    if (pick) used.add(pick);
    return {
      name: pick ? roomNameFromLabel(pick.text) : "",
      w: r.w,
      l: r.l,
      x: region.x * ftPerPx,
      y: region.y * ftPerPx,
      box: region,
      dimText: r.dim.raw,
      fromBox: Boolean(r.box),
    };
  });

  // Labels with no measurement still become rows to fill in.
  for (const lb of labels) {
    if (used.has(lb)) continue;
    const box = enclosingBox(segs, center(lb).x, center(lb).y);
    used.add(lb);
    proposals.push({
      name: roomNameFromLabel(lb.text),
      w: box ? Math.round(box.w * ftPerPx) : 0,
      l: box ? Math.round(box.h * ftPerPx) : 0,
      x: (box ?? lb).x * ftPerPx,
      y: (box ?? lb).y * ftPerPx,
      box: box ?? lb,
      fromBox: Boolean(box),
    });
  }

  // Normalise so the top-left room starts at 0,0.
  const offset = { x: 0, y: 0 };
  if (proposals.length) {
    const mx = Math.min(...proposals.map((p) => p.x));
    const my = Math.min(...proposals.map((p) => p.y));
    for (const p of proposals) {
      p.x -= mx;
      p.y -= my;
    }
    offset.x = mx;
    offset.y = my;
  }
  proposals.forEach((p, i) => (p.name ||= `Room ${i + 1}`));

  const measured = proposals.filter((p) => p.w && p.l).length;
  const quality =
    measured === 0 ? "poor" : sized.every((r) => r.box) && measured === proposals.length ? "good" : "partial";
  return {
    proposals,
    ftPerPx,
    leftover: lines.filter((l) => !used.has(l)).map((l) => l.text),
    quality,
    offset,
  };
}
