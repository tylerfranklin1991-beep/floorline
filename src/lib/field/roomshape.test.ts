import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceTurns, buildOutline, cornerKinds, snapTurns, turnsFromTaps, closesLoop } from "./roomshape.ts";

// L-shape tapped clockwise on screen, with some perspective squish.
const L = [
  { x: 100, y: 400 },
  { x: 140, y: 120 },
  { x: 400, y: 130 },
  { x: 380, y: 260 },
  { x: 260, y: 270 },
  { x: 250, y: 410 },
];

test("reads wall count and inside/outside corners from taps", () => {
  const t = balanceTurns(snapTurns(L, false));
  assert.equal(t.length, 6);
  assert.equal(t.reduce<number>((s, x) => s + x, 0), 360);
  const k = cornerKinds(t);
  assert.equal(k.filter((x) => x === "inside").length, 1);
});

test("counter-clockwise taps give the same shape", () => {
  const t = balanceTurns(snapTurns([...L].reverse(), false));
  assert.equal(t.reduce<number>((s, x) => s + x, 0), 360);
  assert.equal(cornerKinds(t).filter((x) => x === "inside").length, 1);
});

test("rectangle closes from 2 of 4 lengths", () => {
  const r = buildOutline([90, 90, 90, 90], [12, 10, null, null])!;
  assert.deepEqual(r.lengths.map((x) => Math.round(x * 1000) / 1000), [12, 10, 12, 10]);
  assert.ok(r.gap < 1e-9);
});

test("L-shape outline with last wall solved", () => {
  // walls: 12 right, 10 down, 4 left, 5 up(inside), 8 left, ? up
  const r = buildOutline([90, 90, 90, -90, 90, 90], [12, 10, 4, 5, 8, null])!;
  assert.ok(Math.abs(r.lengths[5] - 5) < 1e-9);
  assert.ok(r.gap < 1e-9);
});

test("reports a gap when typed lengths don't close", () => {
  const r = buildOutline([90, 90, 90, 90], [12, 10, 11, 10])!;
  assert.ok(Math.abs(r.gap - 1) < 1e-9);
});

test("45° corner (bay / angled wall)", () => {
  const t = snapTurns([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 130, y: 30 },
    { x: 130, y: 100 },
    { x: 0, y: 100 },
  ]);
  assert.equal(t.filter((x) => Math.abs(x) === 45).length, 2);
  assert.equal(balanceTurns(t).reduce<number>((s, x) => s + x, 0), 360);
});

test("taps across two photos: unknown corners default, loop still closes", () => {
  const taps = [
    { photo: 0, x: 0.1, y: 0.9 },
    { photo: 0, x: 0.15, y: 0.2 },
    { photo: 0, x: 0.9, y: 0.25 },
    { photo: 1, x: 0.8, y: 0.5 },
    { photo: 1, x: 0.5, y: 0.5 },
    { photo: 1, x: 0.45, y: 0.9 },
  ];
  const t = turnsFromTaps(taps, false);
  assert.equal(t.length, 6);
  assert.ok(closesLoop(t));
});

test("counter-clockwise taps keep their direction (not mirrored)", () => {
  const ccw = [...L].reverse().map((p) => ({ photo: 0, ...p }));
  const t = turnsFromTaps(ccw, false);
  assert.equal(t.reduce<number>((s, x) => s + x, 0), -360);
  assert.equal(cornerKinds(t).filter((k) => k === "inside").length, 1);
});
