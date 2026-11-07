import assert from "node:assert/strict";
import { test } from "node:test";
import { carpetLayout, roomFlooring } from "./materials.ts";
import { area, newProperty, newRoom, rectPoints, type Pt } from "./model.ts";
import {
  autoPile,
  carpetPlans,
  layoutTseam,
  unionRectOutline,
  type TseamOptions,
} from "./tseam.ts";

const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];

function opt(over: Partial<TseamOptions> = {}): TseamOptions {
  return {
    units: "ft",
    rollWidthFt: 12,
    trimIn: 3,
    patternRepeatIn: 0,
    pileDeg: 0,
    seamOffsetFt: 0,
    roomId: "r",
    roomName: "Living",
    ...over,
  };
}

test("rectangle: 20 x 15 on a 12 ft roll gets a full drop and a T-seam fill", () => {
  const lay = layoutTseam(rectPoints(0, 0, 20, 15), opt());
  assert.equal(lay.pileDeg, 0);
  assert.equal(lay.pieces.length, 3);
  const full = lay.pieces.find((p) => !p.fill)!;
  assert.equal(full.widthFt, 12);
  assert.equal(full.lengthFt, 20);
  assert.equal(full.cutLengthFt, 20.5);
  const fills = lay.pieces.filter((p) => p.fill);
  assert.deepEqual(
    fills.map((p) => [p.widthFt, p.lengthFt, p.cutLengthFt]),
    [
      [3, 12, 12.5],
      [3, 8, 8.5],
    ],
  );
  const t = lay.marks.filter((m) => m.kind === "t");
  assert.equal(t.length, 1);
  assert.equal(t[0].a.x, 12);
  assert.equal(t[0].a.y, 12);
  assert.equal(t[0].b.y, 15);
  const seam = lay.marks.find((m) => m.kind === "seam")!;
  assert.deepEqual([seam.a.x, seam.a.y, seam.b.x, seam.b.y], [0, 12, 20, 12]);
  // Full drop 20.5 ft plus the two fills packed on one row (max 12.5).
  assert.equal(lay.linearFt, 33);
  assert.equal(lay.sqYd, 44);
  assert.equal(lay.netSf, 300);
  assert.equal(lay.wastePct, 24.24);
  // Pile points the same way on every piece, including the fills.
  for (const p of lay.pieces) assert.deepEqual(p.pile, { x: 1, y: 0 });
});

test("rectangle narrower than the roll is one piece and no seam", () => {
  const lay = layoutTseam(rectPoints(0, 0, 10, 8), opt({ trimIn: 0 }));
  assert.equal(lay.pieces.length, 1);
  assert.equal(lay.marks.length, 0);
  assert.equal(lay.pieces[0].fill, true);
  assert.equal(lay.pieces[0].lengthFt, 10);
  assert.equal(lay.linearFt, 10);
  assert.equal(lay.wastePct, 33.33);
});

test("L-shape seam stays where carpet is on both sides", () => {
  const lay = layoutTseam(L, opt({ trimIn: 0 }));
  assert.equal(lay.pieces.length, 2);
  assert.deepEqual(
    lay.pieces.map((p) => [p.lengthFt, p.widthFt, p.fill]),
    [
      [20, 12, false],
      [10, 8, true],
    ],
  );
  const seams = lay.marks.filter((m) => m.kind === "seam");
  assert.equal(seams.length, 1);
  assert.deepEqual(seams[0], {
    a: { x: 0, y: 12 },
    b: { x: 10, y: 12 },
    kind: "seam",
    roomIds: ["r"],
  });
  assert.equal(lay.marks.some((m) => m.kind === "t"), false);
  // The long seam does not run into the notch.
  assert.ok(seams[0].b.x <= 10);
});

test("room wider than 12 ft: fill longer than the roll is cross-joined", () => {
  // 14 ft across the roll, 30 ft along it. Fill band is 2 x 30, so two T-seams.
  const lay = layoutTseam(rectPoints(0, 0, 30, 14), opt({ trimIn: 0 }));
  const fills = lay.pieces.filter((p) => p.fill);
  assert.deepEqual(
    fills.map((p) => p.lengthFt),
    [12, 12, 6],
  );
  assert.equal(lay.marks.filter((m) => m.kind === "t").length, 2);
  assert.ok(lay.pieces.some((p) => !p.fill && p.widthFt === 12));
});

test("closet is a single short drop", () => {
  // 6'7" x 7'4" — smaller than a 12 ft roll either way.
  const lay = layoutTseam(rectPoints(0, 0, 6 + 7 / 12, 7 + 4 / 12), opt());
  assert.equal(lay.pieces.length, 1);
  assert.equal(lay.marks.length, 0);
  assert.equal(lay.pieces[0].fill, true);
  assert.equal(lay.pieces[0].widthFt, 7.33);
  assert.equal(lay.pieces[0].lengthFt, 6.58);
  assert.equal(lay.pieces[0].cutLengthFt, 7.08);
});

test("pattern repeat cuts the fill on the repeat, not the roll width", () => {
  const lay = layoutTseam(rectPoints(0, 0, 20, 15), opt({ patternRepeatIn: 48, trimIn: 0 }));
  const fills = lay.pieces.filter((p) => p.fill);
  assert.deepEqual(
    fills.map((p) => p.lengthFt),
    [4, 4, 4, 4, 4],
  );
  assert.equal(lay.marks.filter((m) => m.kind === "t").length, 4);
});

test("sliding the seam moves the T-seam band with it", () => {
  const lay = layoutTseam(rectPoints(0, 0, 20, 15), opt({ seamOffsetFt: 6, trimIn: 0 }));
  const seam = lay.marks.find((m) => m.kind === "seam")!;
  assert.equal(seam.a.y, 6);
  const ts = lay.marks.filter((m) => m.kind === "t");
  assert.equal(ts.length, 2);
  assert.ok(ts.some((m) => m.a.y === 0 && m.b.y === 6));
  assert.ok(ts.some((m) => m.a.y === 6 && m.b.y === 15));
});

test("auto pile picks the lower-waste direction", () => {
  const pts = rectPoints(0, 0, 30, 13);
  const chosen = autoPile(pts, opt({ trimIn: 0 }));
  const a = layoutTseam(pts, opt({ pileDeg: 0, trimIn: 0 }));
  const b = layoutTseam(pts, opt({ pileDeg: 90, trimIn: 0 }));
  const better = a.wastePct <= b.wastePct ? 0 : 90;
  assert.equal(chosen, better);
  assert.ok(a.wastePct !== b.wastePct);
  assert.equal(chosen, layoutTseam(pts, opt({ pileDeg: "auto", trimIn: 0 })).pileDeg);
});

test("pile 90 keeps every arrow pointing the same way", () => {
  const lay = layoutTseam(rectPoints(0, 0, 20, 15), opt({ pileDeg: 90, trimIn: 0 }));
  for (const p of lay.pieces) assert.deepEqual(p.pile, { x: 0, y: 1 });
  assert.ok(lay.pieces.length >= 2);
});

test("existing carpetLayout seams are unchanged by the T-seam module", () => {
  const r = newRoom("Living", rectPoints(0, 0, 20, 15), "typed");
  const lay = carpetLayout(r, "ft", { ...roomFlooring(r), trimIn: 0 });
  assert.equal(lay.seams.length, 1);
  assert.equal(lay.seams[0].a.y, 12);
  assert.equal(lay.cuts.length, 2);
});

test("touching room and closet combine into one outline", () => {
  const outline = unionRectOutline([
    { minX: 0, minY: 0, maxX: 12, maxY: 10 },
    { minX: 12, minY: 2, maxX: 16, maxY: 8 },
  ]);
  assert.ok(outline);
  assert.equal(Math.round(Math.abs(area(outline!))), 144);

  const p = newProperty("Job");
  p.combineCarpet = true;
  const room = newRoom("Living", rectPoints(0, 0, 12, 10), "typed");
  room.flooring = { material: "carpet", trimIn: 0 };
  const closet = newRoom("Closet", rectPoints(12, 2, 4, 6), "typed");
  closet.flooring = { material: "carpet", trimIn: 0 };
  closet.closet = { parentId: room.id, includeInParent: false };
  p.rooms = [room, closet];
  const plans = carpetPlans(p);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].title, "Living + Closet");
  assert.equal(plans[0].layout.netSf, 144);
  assert.ok(plans[0].layout.pieces.length >= 1);
});

test("included closet of a carpet room is laid out with the parent when combined", () => {
  const p = newProperty("Job");
  p.combineCarpet = true;
  const room = newRoom("Hall", rectPoints(0, 0, 12, 8), "typed");
  room.flooring = { material: "carpet", trimIn: 0 };
  const closet = newRoom("Hall closet", rectPoints(12, 0, 4, 4), "typed");
  closet.flooring = { material: "none" };
  closet.closet = { parentId: room.id, includeInParent: true };
  p.rooms = [room, closet];
  const plans = carpetPlans(p);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].roomIds.length, 2);
  assert.equal(plans[0].layout.netSf, 112);
});

test("without combine, a closet stays its own cut list", () => {
  const p = newProperty("Job");
  const room = newRoom("Bed", rectPoints(0, 0, 14, 12), "typed");
  room.flooring = { material: "carpet", trimIn: 0 };
  const closet = newRoom("WIC", rectPoints(16, 0, 5, 6), "typed");
  closet.flooring = { material: "carpet", trimIn: 0 };
  p.rooms = [room, closet];
  const plans = carpetPlans(p);
  assert.equal(plans.length, 2);
  const wic = plans.find((x) => x.title === "WIC")!;
  assert.equal(wic.layout.pieces.length, 1);
  assert.equal(wic.layout.marks.length, 0);
});
