import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLength } from "./model.ts";
import {
  DISTO_MAX_METERS,
  encodeMeters,
  metersToPlan,
  parseBasicMeasurement,
  parseDisplayUnit,
  parseDistanceMeters,
  parseModelName,
  planToMeters,
} from "./disto-protocol.ts";

test("1.0 m is the little-endian float 00 00 80 3f", () => {
  const bytes = encodeMeters(1);
  assert.deepEqual([...bytes], [0x00, 0x00, 0x80, 0x3f]);
  const parsed = parseDistanceMeters(bytes);
  assert.equal(parsed.ok && parsed.meters, 1);
  assert.equal(parsed.ok && parsed.source, "distance");
});

test("13 ft 11 in converts to the app's feet-inch label and to metres", () => {
  const meters = 13 * 0.3048 + 11 * 0.0254;
  const parsed = parseDistanceMeters(encodeMeters(meters));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(formatLength(metersToPlan(parsed.meters, "ft"), "ft"), `13'-11"`);
  assert.equal(formatLength(metersToPlan(parsed.meters, "m"), "m"), "4.24 m");
});

test("feet snap to the nearest inch (10 ft 1 in)", () => {
  const meters = 121 * 0.0254;
  assert.equal(formatLength(metersToPlan(meters, "ft"), "ft"), `10'-1"`);
  assert.equal(metersToPlan(1.5, "m"), 1.5);
});

test("plan lengths convert back to metres", () => {
  assert.equal(planToMeters(10, "ft"), 3.048);
  assert.equal(planToMeters(2.5, "m"), 2.5);
});

test("rejects short, empty, zero, negative, huge, NaN, and subnormal packets", () => {
  assert.equal(parseDistanceMeters(new Uint8Array([1, 2, 3])).ok, false);
  assert.equal(parseDistanceMeters(new Uint8Array()).ok, false);
  assert.equal(parseDistanceMeters(encodeMeters(0)).ok, false);
  assert.equal(parseDistanceMeters(encodeMeters(-2)).ok, false);
  assert.equal(parseDistanceMeters(encodeMeters(DISTO_MAX_METERS + 1)).ok, false);
  assert.equal(parseDistanceMeters(encodeMeters(Number.NaN)).ok, false);
  const sub = new Uint8Array(4);
  new DataView(sub.buffer).setUint32(0, 0x00000001, true);
  assert.equal(parseDistanceMeters(sub).ok, false);
});

test("a trailing status byte is ignored; longer junk is not", () => {
  const four = encodeMeters(2.5);
  const five = new Uint8Array([...four, 0x01]);
  const parsed = parseDistanceMeters(five);
  assert.equal(parsed.ok && parsed.meters, 2.5);
  assert.equal(parseDistanceMeters(new Uint8Array(8)).ok, false);
});

test("20-byte basic measurement uses the first float as metres", () => {
  const bytes = new Uint8Array(20);
  new DataView(bytes.buffer).setFloat32(0, 2.5, true);
  new DataView(bytes.buffer).setUint16(12, 9, true);
  const parsed = parseBasicMeasurement(bytes);
  assert.equal(parsed.ok && parsed.meters, 2.5);
  assert.equal(parsed.ok && parsed.source, "basic");
  const again = parseDistanceMeters(bytes);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.source, "basic");
  assert.equal(parseBasicMeasurement(encodeMeters(1)).ok, false);
});

test("unit code 9 is metres and does not rescale; unknown codes are unverified", () => {
  const metres = parseDisplayUnit(new Uint8Array([9, 0]));
  assert.deepEqual(metres, { code: 9, label: "m", unverified: false });
  const unknown = parseDisplayUnit(new Uint8Array([1, 0]));
  assert.equal(unknown?.code, 1);
  assert.equal(unknown?.unverified, true);
  // A 10 m shot stays 10 m no matter what the display-unit characteristic says.
  const shot = parseDistanceMeters(encodeMeters(10));
  assert.equal(shot.ok && shot.meters, 10);
  assert.equal(parseDisplayUnit(new Uint8Array()), null);
});

test("model name drops the trailing NUL and spaces", () => {
  assert.equal(parseModelName(new Uint8Array([0x44, 0x32, 0x20, 0x00, 0x00])), "D2");
  assert.equal(parseModelName(new Uint8Array()), "DISTO");
});
