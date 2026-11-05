import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxesFor,
  carpetLayout,
  carpetOrder,
  lvpOrder,
  materials,
  padOrder,
  roomArea,
  roomFlooring,
  seamPresets,
  stairCarpet,
  stairCarpetFor,
} from "./materials.ts";
import { DEFAULT_JOB, carryOver, jobSettings } from "./job.ts";
import {
  area,
  lShapePoints,
  newProperty,
  newRoom,
  newStairs,
  rectPoints,
  sanitizeProperty,
  type FieldProperty,
} from "./model.ts";
import { materialsCsv, materialsText } from "./takeoff.ts";

function job(): FieldProperty {
  const p = newProperty("Smith");
  p.job = { customer: "Jane Smith", lvpBoxSqFt: 23.64, carpetWastePct: 8 };
  return p;
}

test("LVP: 10% waste by default and boxes always round up", () => {
  const p = job();
  p.rooms = [
    { ...newRoom("Kitchen", rectPoints(0, 0, 12, 10), "typed"), flooring: { material: "hard" } },
  ];
  const o = lvpOrder(p);
  assert.equal(o.sqft, 120);
  assert.equal(o.withWaste, 132);
  assert.equal(o.boxes, 6); // 132 / 23.64 = 5.58 → 6
  assert.equal(boxesFor(47.28, 23.64), 2); // exact multiple stays
  assert.equal(boxesFor(47.29, 23.64), 3);
  assert.equal(boxesFor(10, 0), null); // no coverage typed yet
});

test("waste: job default per material, room override wins", () => {
  const p = job();
  const r = { ...newRoom("Bed", rectPoints(0, 0, 12, 12), "typed"), flooring: { material: "carpet" as const } };
  assert.equal(roomFlooring(r, p.job).wastePct, 8);
  assert.equal(roomFlooring({ ...r, flooring: { material: "hard" } }, p.job).wastePct, 10);
  assert.equal(roomFlooring({ ...r, flooring: { material: "carpet", wastePct: 15 } }, p.job).wastePct, 15);
  // 12' roll and 3" trim come from the job
  assert.equal(roomFlooring(r, p.job).rollWidthFt, 12);
  assert.equal(roomFlooring(r, { ...p.job, rollWidthFt: 15 }).rollWidthFt, 15);
});

test("carpet waste applied per room in the order", () => {
  const p = job();
  p.rooms = [
    { ...newRoom("A", rectPoints(0, 0, 20, 12), "typed"), flooring: { material: "carpet", trimIn: 0 } },
  ];
  assert.equal(carpetOrder(p)[0].linear, 21.6); // 20 × 1.08
  p.rooms[0].flooring = { material: "carpet", trimIn: 0, wastePct: 0 };
  assert.equal(carpetOrder(p)[0].linear, 20);
});

test("seam offset slides the seam and changes the cut widths", () => {
  const r = newRoom("Living", rectPoints(0, 0, 20, 18), "typed");
  const f = { ...roomFlooring(r), trimIn: 0 };
  const base = carpetLayout(r, "ft", f);
  assert.deepEqual(base.cuts.map((c) => c.width), [12, 6]);
  assert.equal(base.seams[0].a.y, 12);
  const off = carpetLayout(r, "ft", { ...f, seamOffsetFt: 6 });
  assert.deepEqual(off.cuts.map((c) => c.width), [6, 12]);
  assert.equal(off.seams.length, 1);
  assert.equal(off.seams[0].a.y, 6);
  const pre = seamPresets(r, f, "ft");
  assert.equal(pre.far, 6);
  const ctr = carpetLayout(r, "ft", { ...f, seamOffsetFt: pre.centre });
  // 18' span on a 12' roll: centred = 9' + 9'
  assert.deepEqual(ctr.cuts.map((c) => c.width), [9, 9]);
  assert.equal(ctr.seams[0].a.y, 9);
  // Three strips with offset: 30' span, offset 3 → 3 + 12 + 12 + 3
  const big = newRoom("Big", rectPoints(0, 0, 10, 30), "typed");
  const b = carpetLayout(big, "ft", { ...f, seamOffsetFt: 3 });
  assert.deepEqual(b.cuts.map((c) => c.width), [3, 12, 12, 3]);
  assert.equal(b.seams.length, 3);
});

test("stair carpet: per-step cuts and LF for box vs waterfall", () => {
  const p = job();
  const s = { ...newStairs("level-main", { x: 0, y: 0 }, "ft"), width: 3, steps: 13 };
  const j = jobSettings(p.job);
  const box = stairCarpetFor(s, "ft", j)!;
  assert.equal(box.pieceWidthIn, 36);
  assert.equal(box.pieceLengthIn, 20.5); // 10 + 7.5 + 3
  assert.equal(box.perRow, 4); // 12' roll / 3' stair
  assert.equal(box.rows, 4); // 13 steps → 4 rows
  assert.equal(box.linear, Math.round(((4 * 20.5) / 12) * 100) / 100);
  const wf = stairCarpetFor({ ...s, style: "waterfall" }, "ft", j)!;
  assert.equal(wf.pieceLengthIn, 19.5);
  assert.equal(stairCarpetFor({ ...s, steps: null }, "ft", j), null);
  assert.equal(stairCarpetFor({ ...s, carpet: false }, "ft", j), null);
  p.stairs = [s];
  assert.equal(stairCarpet(p).length, 1);
  // stairs add to the carpet order and pad
  const o = carpetOrder(p)[0];
  assert.equal(o.stairsLinear, Math.round(box.linear * 1.08 * 100) / 100);
  assert.ok(padOrder(p).sy > 0);
});

test("exclusions and add-on areas change net area, LVP and pad", () => {
  const p = job();
  const r = {
    ...newRoom("Kitchen", rectPoints(0, 0, 15, 12), "typed"),
    flooring: { material: "hard" as const },
    areas: [
      { id: "x1", name: "Island", w: 6, l: 3, kind: "exclude" as const },
      { id: "x2", name: "Pantry", w: 3, l: 2, kind: "add" as const },
    ],
  };
  p.rooms = [r];
  assert.equal(roomArea(r), 180 - 18 + 6);
  assert.equal(lvpOrder(p).sqft, 168);
  assert.equal(materials(p).area.total, 168);
  // carpet add-on gets its own piece
  const c = { ...r, flooring: { material: "carpet" as const, trimIn: 0 } };
  const lay = carpetLayout(c, "ft", roomFlooring(c));
  assert.ok(lay.cuts.some((x) => x.label === "Pantry" && x.width === 2 && x.length === 3));
  // survives save / reload
  const back = sanitizeProperty(JSON.parse(JSON.stringify(p)))!;
  assert.equal(back.rooms[0].areas!.length, 2);
  assert.equal(back.job!.customer, "Jane Smith");
});

test("L-shape helper", () => {
  const pts = lShapePoints(20, 15, 8, 5)!;
  assert.equal(pts.length, 6);
  assert.equal(area(pts), 300 - 40);
  assert.equal(lShapePoints(10, 10, 10, 2), null);
  for (const c of ["tl", "br", "bl"] as const) assert.equal(area(lShapePoints(20, 15, 8, 5, c)!), 260);
});

test("job settings: defaults, bad values, carry-over drops customer", () => {
  const j = jobSettings({ lvpWastePct: -3 as number, rollWidthFt: Number.NaN });
  assert.equal(j.lvpWastePct, 10);
  assert.equal(j.rollWidthFt, 12);
  assert.equal(DEFAULT_JOB.defaultMaterial, "hard");
  const c = carryOver(jobSettings({ customer: "X", lvpBoxSqFt: 20 }));
  assert.equal("customer" in c, false);
  assert.equal(c.lvpBoxSqFt, 20);
});

test("materials text and CSV list everything", () => {
  const p = job();
  p.rooms = [
    { ...newRoom("Kitchen", rectPoints(0, 0, 12, 10), "typed"), flooring: { material: "hard" } },
    { ...newRoom("Bed 1", rectPoints(0, 12, 12, 12), "typed"), flooring: { material: "carpet" } },
  ];
  p.stairs = [{ ...newStairs("level-main", { x: 30, y: 0 }, "ft"), steps: 13 }];
  const t = materialsText(p);
  assert.match(t, /Jane Smith/);
  assert.match(t, /LVP.*6 boxes/);
  assert.match(t, /Carpet 12'/);
  assert.match(t, /Pad/);
  assert.match(t, /Stairs.*13 steps/);
  const csv = materialsCsv(p);
  assert.match(csv.split("\n")[0], /^Item,/);
  assert.ok(csv.includes('"Kitchen"'));
});
