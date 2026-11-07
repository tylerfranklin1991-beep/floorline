/**
 * Customer quote built from the plan. Rates start at zero — nothing here is
 * a guessed price. Square footage, boxes, carpet yards and doorway counts
 * come from the drawing; the dollar amounts come from the price list.
 */
import { jobSettings } from "./job.ts";
import {
  baseboard,
  billableArea,
  boxesFor,
  roomFlooring,
  stairCarpet,
  toSqFt,
  TRANSITION_LABEL,
  transitions,
  type TransitionType,
} from "./materials.ts";
import { formatLength, round2, type FieldProperty, type Units } from "./model.ts";
import { carpetPlans } from "./tseam.ts";

export const DEFAULT_LVP_BOX_SF = 23.77;

export type RateKey =
  | "lvpPerSf"
  | "lvpLaborPerSf"
  | "carpetPerSy"
  | "carpetLaborPerSy"
  | "padPerSy"
  | "tearOutPerSf"
  | "haulPerSf"
  | "polyPerSf"
  | "levelPerSf"
  | "furniturePerRoom"
  | "transitionEach"
  | "quarterPerLf"
  | "basePerLf";

export type PriceRates = Record<RateKey, number>;

export interface PriceBook {
  rates: PriceRates;
  markupPct: number;
  taxPct: number;
  discount: number;
  depositPct: number;
  validDays: number;
  terms: string;
}

export interface BusinessProfile {
  name: string;
  phone: string;
  email: string;
  license: string;
  /** Data URL of an uploaded logo. Empty uses the bundled SCG mark. */
  logoDataUrl: string;
}

export interface QuoteLine {
  id: string;
  label: string;
  qty: number;
  unit: string;
  price: number;
  rateKey?: RateKey;
  custom?: boolean;
}

export interface SavedQuote {
  number: string;
  date: string;
  validDays: number;
  customer: string;
  address: string;
  lines: QuoteLine[];
  markupPct: number;
  taxPct: number;
  discount: number;
  depositPct: number;
  notes: string;
  signature: string;
}

export const EMPTY_RATES: PriceRates = {
  lvpPerSf: 0,
  lvpLaborPerSf: 0,
  carpetPerSy: 0,
  carpetLaborPerSy: 0,
  padPerSy: 0,
  tearOutPerSf: 0,
  haulPerSf: 0,
  polyPerSf: 0,
  levelPerSf: 0,
  furniturePerRoom: 0,
  transitionEach: 0,
  quarterPerLf: 0,
  basePerLf: 0,
};

export const DEFAULT_TERMS =
  "Prices stay as written for the validity period. Floor prep is figured for a typical slab; extra leveling is added if the slab needs it. A deposit schedules the job. The balance is due when the floor is finished.";

export const EMPTY_BOOK: PriceBook = {
  rates: { ...EMPTY_RATES },
  markupPct: 0,
  taxPct: 0,
  discount: 0,
  depositPct: 0,
  validDays: 30,
  terms: DEFAULT_TERMS,
};

/** Name and the published SCG phone. The logo file is the site mark; both are replaceable. */
export const DEFAULT_BUSINESS: BusinessProfile = {
  name: "SCG",
  phone: "833-724-0732",
  email: "",
  license: "",
  logoDataUrl: "",
};

const num = (v: unknown, d = 0, min = 0, max = 1e7) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function pricesBlank(rates: PriceRates): boolean {
  return (Object.keys(EMPTY_RATES) as RateKey[]).every((k) => !(rates[k] > 0));
}

function line(partial: QuoteLine): QuoteLine {
  return { ...partial, qty: round2(partial.qty), price: round2(partial.price) };
}

function feet(units: Units, plan: number): number {
  return units === "ft" ? plan : plan / 0.3048;
}

/** Lines the plan can fill in. Prices come from the saved price list (0 until set). */
export function buildQuoteLines(p: FieldProperty, rates: PriceRates = EMPTY_RATES): QuoteLine[] {
  const job = jobSettings(p.job);
  const lines: QuoteLine[] = [];
  const box = job.lvpBoxSqFt > 0 ? job.lvpBoxSqFt : DEFAULT_LVP_BOX_SF;
  const boxNote = job.lvpBoxSqFt > 0 ? "" : " — box size not set, using 23.77 sf";
  let floorSf = 0;
  let hardSf = 0;
  let rooms = 0;

  for (const r of p.rooms) {
    const f = roomFlooring(r, p.job);
    if (f.material === "none") continue;
    const net = round2(toSqFt(billableArea(p, r), p.units));
    if (!(net > 0)) continue;
    floorSf += net;
    rooms += 1;
    if (f.material === "hard") {
      hardSf += net;
      const withWaste = net * (1 + f.wastePct / 100);
      const boxes = boxesFor(withWaste, box) ?? 0;
      const billed = boxes > 0 ? boxes * box : withWaste;
      lines.push(
        line({
          id: `lvp-${r.id}`,
          label: `${r.name} — LVP, ${f.wastePct}% waste, ${boxes} box${boxes === 1 ? "" : "es"} @ ${box} sf${boxNote}`,
          qty: billed,
          unit: "sf",
          price: rates.lvpPerSf,
          rateKey: "lvpPerSf",
        }),
      );
      lines.push(
        line({
          id: `lvp-labor-${r.id}`,
          label: `${r.name} — LVP labor`,
          qty: net,
          unit: "sf",
          price: rates.lvpLaborPerSf,
          rateKey: "lvpLaborPerSf",
        }),
      );
    }
  }

  for (const plan of carpetPlans(p)) {
    const lay = plan.layout;
    if (!(lay.netSf > 0) && lay.pieces.length === 0) continue;
    floorSf += 0; // carpet net is already in the room loop when the room material is carpet
    lines.push(
      line({
        id: `carpet-${plan.roomIds.join("-")}`,
        label: `${plan.title} — carpet, ${lay.linearFt} lin ft, ${lay.wastePct}% waste`,
        qty: lay.sqYd,
        unit: "sq yd",
        price: rates.carpetPerSy,
        rateKey: "carpetPerSy",
      }),
    );
    lines.push(
      line({
        id: `carpet-labor-${plan.roomIds.join("-")}`,
        label: `${plan.title} — carpet labor`,
        qty: round2(lay.netSf / 9),
        unit: "sq yd",
        price: rates.carpetLaborPerSy,
        rateKey: "carpetLaborPerSy",
      }),
    );
    if (job.pad) {
      const sy =
        lay.netSf > 0
          ? Math.ceil(((lay.netSf / 9) * (1 + job.padWastePct / 100)) * 10 - 1e-9) / 10
          : 0;
      lines.push(
        line({
          id: `pad-${plan.roomIds.join("-")}`,
          label: `${plan.title} — carpet pad, ${job.padWastePct}% waste`,
          qty: sy,
          unit: "sq yd",
          price: rates.padPerSy,
          rateKey: "padPerSy",
        }),
      );
    }
  }

  const stairs = stairCarpet(p);
  if (stairs.length) {
    const sf = stairs.reduce((s, x) => s + x.sqft, 0);
    lines.push(
      line({
        id: "stairs",
        label: `Stairs — carpet, ${stairs.reduce((s, x) => s + x.steps, 0)} steps`,
        qty: round2(sf / 9),
        unit: "sq yd",
        price: rates.carpetPerSy,
        rateKey: "carpetPerSy",
      }),
    );
  }

  if (floorSf > 0) {
    lines.push(
      line({
        id: "tearout",
        label: "Tear-out",
        qty: round2(floorSf),
        unit: "sf",
        price: rates.tearOutPerSf,
        rateKey: "tearOutPerSf",
      }),
      line({
        id: "haul",
        label: "Haul-away",
        qty: round2(floorSf),
        unit: "sf",
        price: rates.haulPerSf,
        rateKey: "haulPerSf",
      }),
    );
  }
  if (hardSf > 0) {
    lines.push(
      line({
        id: "poly",
        label: "6-mil poly on slab — change the quantity if it is not the whole hard floor",
        qty: round2(hardSf),
        unit: "sf",
        price: rates.polyPerSf,
        rateKey: "polyPerSf",
      }),
      line({
        id: "level",
        label: "Floor leveling — change the quantity to the area that needs it",
        qty: round2(hardSf),
        unit: "sf",
        price: rates.levelPerSf,
        rateKey: "levelPerSf",
      }),
    );
  }
  if (rooms > 0) {
    lines.push(
      line({
        id: "furniture",
        label: "Furniture moving",
        qty: rooms,
        unit: "room",
        price: rates.furniturePerRoom,
        rateKey: "furniturePerRoom",
      }),
    );
  }

  const byType = new Map<TransitionType, { count: number; width: number }>();
  for (const t of transitions(p)) {
    if (t.type === "none") continue;
    const cur = byType.get(t.type) ?? { count: 0, width: 0 };
    cur.count += 1;
    cur.width += feet(p.units, t.width);
    byType.set(t.type, cur);
  }
  for (const [type, info] of byType) {
    lines.push(
      line({
        id: `trans-${type}`,
        label: `${TRANSITION_LABEL[type]} — ${formatLength(info.width, "ft")} total`,
        qty: info.count,
        unit: "ea",
        price: rates.transitionEach,
        rateKey: "transitionEach",
      }),
    );
  }

  let baseFt = 0;
  let quarterFt = 0;
  for (const r of p.rooms) {
    const f = roomFlooring(r, p.job);
    if (f.material === "none") continue;
    const run = feet(p.units, baseboard(p, r));
    baseFt += run;
    if (f.quarterRound) quarterFt += run;
  }
  if (baseFt > 0) {
    lines.push(
      line({
        id: "base",
        label: "Baseboard",
        qty: round2(baseFt),
        unit: "lin ft",
        price: rates.basePerLf,
        rateKey: "basePerLf",
      }),
    );
  }
  if (quarterFt > 0) {
    lines.push(
      line({
        id: "quarter",
        label: "Quarter round",
        qty: round2(quarterFt),
        unit: "lin ft",
        price: rates.quarterPerLf,
        rateKey: "quarterPerLf",
      }),
    );
  }
  return lines;
}

export function lineAmount(l: QuoteLine): number {
  return round2(l.qty * l.price);
}

export function quoteTotals(q: Pick<SavedQuote, "lines" | "markupPct" | "taxPct" | "discount" | "depositPct">) {
  const subtotal = round2(q.lines.reduce((s, l) => s + lineAmount(l), 0));
  const markup = round2((subtotal * num(q.markupPct)) / 100);
  const afterDiscount = subtotal + markup - num(q.discount);
  const taxable = Math.max(0, afterDiscount);
  const tax = round2((taxable * num(q.taxPct)) / 100);
  const total = round2(taxable + tax);
  const deposit = round2((total * num(q.depositPct)) / 100);
  return {
    subtotal,
    markup,
    discount: round2(num(q.discount)),
    tax,
    total,
    deposit,
    balance: round2(total - deposit),
  };
}

/** Rebuild quantities from the plan. Keep each line's price, and keep custom lines. */
export function refreshLines(p: FieldProperty, previous: QuoteLine[], rates: PriceRates): QuoteLine[] {
  const fresh = buildQuoteLines(p, rates);
  const prev = new Map(previous.filter((l) => !l.custom).map((l) => [l.id, l]));
  const out = fresh.map((l) => {
    const old = prev.get(l.id);
    return old ? { ...l, price: old.price } : l;
  });
  for (const l of previous) if (l.custom) out.push(l);
  return out;
}

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function freshQuote(p: FieldProperty, book: PriceBook, number: string): SavedQuote {
  const job = jobSettings(p.job);
  return {
    number,
    date: today(),
    validDays: book.validDays,
    customer: job.customer,
    address: p.address,
    lines: buildQuoteLines(p, book.rates),
    markupPct: book.markupPct,
    taxPct: book.taxPct,
    discount: book.discount,
    depositPct: book.depositPct,
    notes: book.terms,
    signature: "",
  };
}

export function parseQuote(value: unknown, p: FieldProperty, book: PriceBook): SavedQuote {
  const v = (value ?? {}) as Partial<SavedQuote>;
  const base = freshQuote(p, book, str(v.number, "SCG-1001"));
  if (!Array.isArray(v.lines) || v.lines.length === 0) return { ...base, number: str(v.number, base.number) };
  const lines = v.lines
    .filter((l) => l && typeof l === "object")
    .map((l) => {
      const row = l as Partial<QuoteLine>;
      return line({
        id: str(row.id, `custom-${Math.random().toString(36).slice(2, 7)}`),
        label: str(row.label, "Item"),
        qty: num(row.qty),
        unit: str(row.unit, "ea"),
        price: num(row.price),
        ...(typeof row.rateKey === "string" ? { rateKey: row.rateKey as RateKey } : {}),
        ...(row.custom ? { custom: true } : {}),
      });
    });
  return {
    number: str(v.number, base.number),
    date: str(v.date, base.date),
    validDays: num(v.validDays, book.validDays, 0, 3650),
    customer: str(v.customer, base.customer),
    address: str(v.address, base.address),
    lines: lines.length ? lines : base.lines,
    markupPct: num(v.markupPct, book.markupPct, 0, 500),
    taxPct: num(v.taxPct, book.taxPct, 0, 50),
    discount: num(v.discount, book.discount),
    depositPct: num(v.depositPct, book.depositPct, 0, 100),
    notes: str(v.notes, book.terms),
    signature: str(v.signature),
  };
}

const PRICE_KEY = "floorline-price-list";
const BUSINESS_KEY = "floorline-business";
const SEQ_KEY = "floorline-quote-seq";

export function loadBook(): PriceBook {
  try {
    const raw = globalThis.localStorage?.getItem(PRICE_KEY);
    if (!raw) return { ...EMPTY_BOOK, rates: { ...EMPTY_RATES } };
    const v = JSON.parse(raw) as Partial<PriceBook> & { rates?: Partial<PriceRates> };
    const rates = { ...EMPTY_RATES };
    for (const k of Object.keys(EMPTY_RATES) as RateKey[]) rates[k] = num(v.rates?.[k]);
    return {
      rates,
      markupPct: num(v.markupPct, 0, 0, 500),
      taxPct: num(v.taxPct, 0, 0, 50),
      discount: num(v.discount),
      depositPct: num(v.depositPct, 0, 0, 100),
      validDays: num(v.validDays, 30, 0, 3650),
      terms: str(v.terms, DEFAULT_TERMS),
    };
  } catch {
    return { ...EMPTY_BOOK, rates: { ...EMPTY_RATES } };
  }
}

export function saveBook(book: PriceBook) {
  try {
    globalThis.localStorage?.setItem(PRICE_KEY, JSON.stringify(book));
  } catch {
    /* storage full */
  }
}

export function loadBusiness(): BusinessProfile {
  try {
    const raw = globalThis.localStorage?.getItem(BUSINESS_KEY);
    if (!raw) return { ...DEFAULT_BUSINESS };
    const v = JSON.parse(raw) as Partial<BusinessProfile>;
    return {
      name: str(v.name, DEFAULT_BUSINESS.name) || DEFAULT_BUSINESS.name,
      phone: str(v.phone, DEFAULT_BUSINESS.phone),
      email: str(v.email),
      license: str(v.license),
      logoDataUrl: str(v.logoDataUrl),
    };
  } catch {
    return { ...DEFAULT_BUSINESS };
  }
}

export function saveBusiness(b: BusinessProfile) {
  try {
    globalThis.localStorage?.setItem(BUSINESS_KEY, JSON.stringify(b));
  } catch {
    /* storage full — the logo is the usual cause */
  }
}

export function peekQuoteNumber(): string {
  try {
    const n = Number(globalThis.localStorage?.getItem(SEQ_KEY) ?? 1000);
    return `SCG-${Number.isFinite(n) && n >= 1 ? n : 1000}`;
  } catch {
    return "SCG-1000";
  }
}

/** Next quote number. Called once when a job gets its first quote. */
export function takeQuoteNumber(): string {
  const current = peekQuoteNumber();
  try {
    const n = Number(current.slice(4));
    globalThis.localStorage?.setItem(SEQ_KEY, String(n + 1));
  } catch {
    /* ignore */
  }
  return current;
}

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function validThrough(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  if (!Number.isFinite(d.getTime())) return "";
  d.setDate(d.getDate() + Math.max(0, days));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
