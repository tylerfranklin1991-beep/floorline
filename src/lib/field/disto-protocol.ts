/**
 * Leica DISTO BLE measurement parser and unit conversion.
 *
 * Public sources (checked Nov 2026):
 * - `disto` crate protocol (docs.rs): service `3ab10100-f831-4395-b29d-570977d5bf94`;
 *   distance `…0101` is notify, little-endian f32, metres; display-unit `…0102`
 *   is a little-endian 16-bit code. The only distance code observed on a D2G
 *   is `9` = metres. Basic measurement `…010d` is 20 bytes, distance at byte 0.
 * - seichter/d2relay notes: a DISTO D2 exposes `…0101` as a 4-byte IEEE-754
 *   float and `…0102` as 2 bytes. That author only measured in metres.
 * - Stack Overflow 69629692 and the murkle D2 web-bluetooth sample read
 *   `…0101` with getFloat32(0, littleEndian) and treat it as metres.
 *
 * Unverified: the numeric display-unit codes for feet and feet-inch. Because
 * every source that states a unit says the distance float is metres, this
 * parser never rescales by the unit code. Unknown codes are reported and ignored.
 * The consumer D2 (BLE 4.0) is documented to indicate/notify `…0101`; the 20-byte
 * `…010d` packet is from the D2G-class profile and is accepted as a fallback.
 */

import { round2, type Units } from "./model.ts";

export const DISTO_SERVICE = "3ab10100-f831-4395-b29d-570977d5bf94";
export const DISTO_DISTANCE = "3ab10101-f831-4395-b29d-570977d5bf94";
export const DISTO_DISTANCE_UNIT = "3ab10102-f831-4395-b29d-570977d5bf94";
export const DISTO_MODEL = "3ab1010c-f831-4395-b29d-570977d5bf94";
export const DISTO_BASIC = "3ab1010d-f831-4395-b29d-570977d5bf94";

/** D2 is rated to 100 m. Other DISTOs that share this profile reach about 200–250 m. */
export const DISTO_MAX_METERS = 250;

/** Observed on a D2G measuring in metres (disto crate). Not a closed enum. */
export const DISTO_UNIT_METRES = 9;

export type DistanceSource = "distance" | "basic";

export type DistanceParse =
  | { ok: true; meters: number; source: DistanceSource }
  | { ok: false; reason: string };

export type DisplayUnit = {
  code: number;
  /** "m" only for the one verified code. */
  label: string;
  /** True when this code is not in the verified set. Distance is still metres. */
  unverified: boolean;
};

export function encodeMeters(meters: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, meters, true);
  return bytes;
}

/** Little-endian f32, or null when the buffer is short, NaN, infinite, or subnormal. */
export function readFloat32LE(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bits = view.getUint32(0, true);
  const exp = (bits >>> 23) & 0xff;
  const frac = bits & 0x7fffff;
  if (exp === 0xff) return null;
  if (exp === 0 && frac !== 0) return null;
  const value = view.getFloat32(0, true);
  if (!Number.isFinite(value)) return null;
  return value;
}

function acceptMeters(value: number | null): DistanceParse {
  if (value == null) return { ok: false, reason: "Not a 4-byte little-endian measurement." };
  if (value <= 0) return { ok: false, reason: "Distance was zero or negative." };
  if (value > DISTO_MAX_METERS) return { ok: false, reason: "Distance is outside the DISTO range." };
  return { ok: true, meters: value, source: "distance" };
}

/**
 * Decode a distance notification.
 * Accepts a 4-byte float, a 5-byte float with one trailing status byte,
 * or a 20-byte basic-measurement packet (distance in the first float).
 */
export function parseDistanceMeters(bytes: Uint8Array): DistanceParse {
  if (bytes.byteLength >= 20) {
    const basic = parseBasicMeasurement(bytes);
    if (basic.ok) return basic;
  }
  if (bytes.byteLength !== 4 && bytes.byteLength !== 5) {
    return { ok: false, reason: "Distance packet is the wrong length." };
  }
  return acceptMeters(readFloat32LE(bytes.subarray(0, 4)));
}

/** 20-byte basic measurement. Distance (metres) is the first little-endian float. */
export function parseBasicMeasurement(bytes: Uint8Array): DistanceParse {
  if (bytes.byteLength < 20) return { ok: false, reason: "Basic measurement is shorter than 20 bytes." };
  const parsed = acceptMeters(readFloat32LE(bytes.subarray(0, 4)));
  if (!parsed.ok) return parsed;
  return { ...parsed, source: "basic" };
}

/**
 * Display-unit characteristic. Does not change how distance bytes are read.
 * Code 9 is the only value confirmed in public captures (metres on a D2G).
 */
export function parseDisplayUnit(bytes: Uint8Array): DisplayUnit | null {
  if (bytes.byteLength < 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const code = bytes.byteLength >= 2 ? view.getUint16(0, true) : view.getUint8(0);
  if (code === DISTO_UNIT_METRES) return { code, label: "m", unverified: false };
  return { code, label: `unit ${code}`, unverified: true };
}

/** Model-name characteristic is a short C string ("D2 "). */
export function parseModelName(bytes: Uint8Array): string {
  let end = bytes.byteLength;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  const text = new TextDecoder().decode(bytes.subarray(0, end)).trim();
  return text || "DISTO";
}

/** Metres → plan units. Feet snap to the nearest inch, then to the model's 0.01 ft. */
export function metersToPlan(meters: number, units: Units): number {
  if (!Number.isFinite(meters)) return 0;
  if (units === "m") return round2(meters);
  const inches = Math.round(meters / 0.0254);
  return round2(inches / 12);
}

/** Plan length → metres (the wire unit). */
export function planToMeters(length: number, units: Units): number {
  if (!Number.isFinite(length)) return 0;
  return units === "m" ? length : length * 0.3048;
}
