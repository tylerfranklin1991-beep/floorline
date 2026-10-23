/**
 * Per-job settings (customer info + material defaults) and the "last used"
 * settings remembered for the next new job. Pure apart from the storage helpers.
 */
export type HardKind = "lvp";

export interface JobSettings {
  customer: string;
  phone: string;
  email: string;
  /** Free text, e.g. "Thu Oct 22, 8 AM". */
  installDate: string;
  jobNotes: string;
  /** Material for new rooms. */
  defaultMaterial: "hard" | "carpet";
  /** LVP waste percent (Tyler: 10). */
  lvpWastePct: number;
  /** Sq ft per LVP box (0 = unknown, no box count). */
  lvpBoxSqFt: number;
  lvpProduct: string;
  /** Carpet waste percent for the job; a room can override it. */
  carpetWastePct: number;
  rollWidthFt: number;
  trimIn: number;
  carpetProduct: string;
  /** Pad / cushion under carpet. */
  pad: boolean;
  padWastePct: number;
  padProduct: string;
  stairStyle: "box" | "waterfall";
  treadIn: number;
  riserIn: number;
}

export const DEFAULT_JOB: JobSettings = {
  customer: "",
  phone: "",
  email: "",
  installDate: "",
  jobNotes: "",
  defaultMaterial: "hard",
  lvpWastePct: 10,
  lvpBoxSqFt: 0,
  lvpProduct: "",
  carpetWastePct: 10,
  rollWidthFt: 12,
  trimIn: 3,
  carpetProduct: "",
  pad: true,
  padWastePct: 5,
  padProduct: "",
  stairStyle: "box",
  treadIn: 10,
  riserIn: 7.5,
};

const num = (v: unknown, d: number, min = 0, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Fill gaps / bad values in saved settings with defaults. */
export function jobSettings(j?: Partial<JobSettings> | null): JobSettings {
  const v = (j ?? {}) as Partial<JobSettings>;
  return {
    customer: str(v.customer),
    phone: str(v.phone),
    email: str(v.email),
    installDate: str(v.installDate),
    jobNotes: str(v.jobNotes),
    defaultMaterial: v.defaultMaterial === "carpet" ? "carpet" : "hard",
    lvpWastePct: num(v.lvpWastePct, DEFAULT_JOB.lvpWastePct, 0, 100),
    lvpBoxSqFt: num(v.lvpBoxSqFt, 0, 0, 1000),
    lvpProduct: str(v.lvpProduct),
    carpetWastePct: num(v.carpetWastePct, DEFAULT_JOB.carpetWastePct, 0, 100),
    rollWidthFt: num(v.rollWidthFt, 12, 1, 30),
    trimIn: num(v.trimIn, 3, 0, 36),
    carpetProduct: str(v.carpetProduct),
    pad: v.pad !== false,
    padWastePct: num(v.padWastePct, 5, 0, 100),
    padProduct: str(v.padProduct),
    stairStyle: v.stairStyle === "waterfall" ? "waterfall" : "box",
    treadIn: num(v.treadIn, 10, 1, 48),
    riserIn: num(v.riserIn, 7.5, 0, 24),
  };
}

/** Settings that carry over to the next job (not customer details). */
export function carryOver(j: JobSettings): Partial<JobSettings> {
  const { customer: _c, phone: _p, email: _e, installDate: _d, jobNotes: _n, ...rest } = j;
  return rest;
}

const LAST_KEY = "floorline-last-job-settings";
export function loadLastSettings(): Partial<JobSettings> {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_KEY);
    return raw ? carryOver(jobSettings(JSON.parse(raw))) : {};
  } catch {
    return {};
  }
}
export function saveLastSettings(j: Partial<JobSettings>) {
  try {
    globalThis.localStorage?.setItem(LAST_KEY, JSON.stringify(carryOver(jobSettings(j))));
  } catch {
    /* storage full — not critical */
  }
}
