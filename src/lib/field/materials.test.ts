import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaSummary,
  baseboard,
  carpetLayout,
  carpetOrder,
  crossSection,
  materials,
  packRoll,
  stairsArea,
  transitions,
  type Cut,
} from "./materials.ts";
import { newProperty, newRoom, rectPoints, type FieldProperty, type Pt } from "./model.ts";

const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];

function prop(): FieldProperty {
  const p = newProperty("Test");
  const a = newRoom("A", rectPoints(0, 0, 12, 10), "typed");
  const b = newRoom("B", rectPoints(12, 0, 10, 10), "typed");
  a.id = "a";
  b.id = "b";
  p.rooms = [a, b];
  return p;
}

test("area: rectangle and L-shape, totals per level, metric", () => {
  const p = prop();
  p.rooms.push({ ...newRoom("L", L, "draw", "up"), id: "l" });
  p.levels.push({ id: "up", name: "Up" });
  const s = areaSummary(p);
  assert.equal(s.rooms[0].area, 120);
  assert.equal(s.rooms[2].area, 300);
  assert.equal(s.levels[0].area, 220);
  assert.equal(s.levels[1].area, 300);
  assert.equal(s.total, 520);
});

test("area: stairs optional, by step count or footprint", () => {
  const p = prop();
  p.stairs = [
    {
      id: "s",
      levelId: "level-main",
      x: 0,
      y: 0,
      width: 3,
      length: 10,
      heading: "n",
      direction: "up",
      steps: 12,
      toLevelId: null,
    },
  ];
  assert.equal(areaSummary(p, false).total, 220);
  const withStairs = areaSummary(p, true);
  assert.equal(Math.round(withStairs.stairsArea * 100) / 100, 52.5); // 12 × 3 × 17.5/12
  assert.equal(Math.round(withStairs.total * 10) / 10, 272.5);
  assert.equal(withStairs.steps, 12);
  assert.equal(stairsArea({ ...p.stairs[0], steps: null }, "ft"), 30);
});

test("crossSection on an L", () => {
  assert.deepEqual(crossSection(L, 5), [[0, 20]]);
  assert.deepEqual(crossSection(L, 15), [[0, 10]]);
});

test("carpet: 12x10 room fits one 12' drop with trim", () => {
  const r = newRoom("A", rectPoints(0, 0, 12, 10), "typed");
  // Rolls run left-right: 10' deep room < 12' roll → one drop 12' + 2×3".
  const lay = carpetLayout(r, "ft");
  assert.equal(lay.cuts.length, 1);
  assert.equal(lay.cuts[0].length, 12.5);
  assert.equal(lay.cuts[0].width, 10);
  assert.equal(lay.seams.length, 0);
});

test("carpet: 20x15 room → full drop + fill, one seam; rotating pile changes layout", () => {
  const r = newRoom("A", rectPoints(0, 0, 20, 15), "typed");
  const lay = carpetLayout(r, "ft", { ...carpetDefaults(), trimIn: 0 });
  assert.deepEqual(
    lay.cuts.map((c) => [c.length, c.width, c.fill]),
    [
      [20, 12, false],
      [20, 3, true],
    ],
  );
  assert.equal(lay.seams.length, 1);
  assert.deepEqual(lay.seams[0], { a: { x: 0, y: 12 }, b: { x: 20, y: 12 } });
  const rot = carpetLayout(r, "ft", { ...carpetDefaults(), trimIn: 0, pileDeg: 90 });
  assert.deepEqual(
    rot.cuts.map((c) => [c.length, c.width]),
    [
      [15, 12],
      [15, 8],
    ],
  );
  assert.equal(rot.length, 30);
  // Seam is a vertical line on the plan for vertical rolls.
  assert.equal(rot.seams[0].a.x, rot.seams[0].b.x);
  assert.equal(Math.abs(rot.seams[0].b.y - rot.seams[0].a.y), 15);
  // Cuts cover the room exactly (no trim).
  const covered = rot.cuts.reduce((s, c) => s + c.rect.w * c.rect.h, 0);
  assert.equal(covered, 300);
});

test("carpet: L-shape seam only where carpet is on both sides; 15' roll removes it", () => {
  const r = newRoom("L", L, "draw");
  const lay = carpetLayout(r, "ft", { ...carpetDefaults(), trimIn: 0 });
  // Strip 0-12: spans 0..20 (top 10 rows are 20 wide). Strip 12-20: 0..10.
  assert.deepEqual(
    lay.cuts.map((c) => [c.length, c.width]),
    [
      [20, 12],
      [10, 8],
    ],
  );
  assert.deepEqual(lay.seams, [{ a: { x: 0, y: 12 }, b: { x: 10, y: 12 } }]);
  const wide = carpetLayout(r, "ft", { ...carpetDefaults(), trimIn: 0, rollWidthFt: 15 });
  assert.equal(wide.cuts.length, 2);
  assert.equal(wide.seams[0].a.y, 15);
});

test("carpet: U-shape band gives two separate drops", () => {
  const U: Pt[] = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 4 },
    { x: 10, y: 4 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // Rolls running up-down: one 12' band x 0..12 covers parts of both legs.
  const lay = carpetLayout(newRoom("U", U, "draw"), "ft", { ...carpetDefaults(), trimIn: 0 });
  assert.equal(lay.cuts.length, 1); // rows: band y 0..10 has one 30' span
  const down = carpetLayout(newRoom("U", U, "draw"), "ft", {
    ...carpetDefaults(),
    trimIn: 0,
    pileDeg: 90,
  });
  // vertical rolls: bands across x 0-12, 12-24, 24-30
  assert.deepEqual(
    down.cuts.map((c) => [c.length, c.width]),
    [
      [10, 12],
      [10, 12],
      [10, 6],
    ],
  );
});

test("carpet order: fills reused across rooms, LF and SY with waste", () => {
  const p = prop();
  p.rooms = [
    { ...newRoom("A", rectPoints(0, 0, 20, 15), "typed"), flooring: { trimIn: 0, wastePct: 0 } },
    { ...newRoom("B", rectPoints(0, 20, 18, 16), "typed"), flooring: { trimIn: 0, wastePct: 0 } },
  ];
  // A: 20×12 + 20×3 fill. B: 18×12 + 18×4 fill.
  const plain = carpetOrder(p)[0];
  assert.equal(plain.linear, 76);
  assert.equal(plain.yards, Math.round(((76 * 12) / 9) * 100) / 100);
  p.reuseFills = true;
  const packed = carpetOrder(p)[0];
  assert.equal(packed.linear, 58); // 20 + 18 + one 20' piece carrying both fills (3'+4')
  assert.equal(packed.pieces.length, 3);
  p.rooms[0].flooring = { trimIn: 0, wastePct: 10 };
  // Waste is per room now: A's 20' drop and the shared fill piece get 10%, B's drop 0%.
  assert.equal(carpetOrder(p)[0].linear, 62);
});

test("packRoll never overfills the roll width", () => {
  const c = (length: number, width: number): Cut => ({
    roomId: "r",
    length,
    width,
    fill: true,
    rect: { x: 0, y: 0, w: length, h: width },
  });
  const pieces = packRoll([c(10, 7), c(9, 6), c(8, 5), c(4, 5)], 12, true);
  for (const p of pieces) assert.ok(p.usedWidth <= 12);
  assert.equal(pieces.flatMap((p) => p.cuts).length, 4);
  assert.equal(
    pieces.reduce((s, p) => s + p.length, 0),
    19,
  );
});

test("metric: roll width converts", () => {
  const r = newRoom("A", rectPoints(0, 0, 5, 4), "typed");
  const lay = carpetLayout(r, "m", { ...carpetDefaults(), trimIn: 0 });
  assert.equal(lay.cuts.length, 2); // 3.66 m roll, 4 m deep
  assert.ok(Math.abs(lay.cuts[0].width - 3.66) < 0.01);
});

test("baseboard: perimeter minus doorways and excluded walls; quarter round", () => {
  const p = prop();
  p.openings = [
    { id: "d", roomId: "a", kind: "door", wall: 1, offset: 5, width: 3 },
    { id: "w", roomId: "a", kind: "window", wall: 0, offset: 5, width: 3 },
  ];
  assert.equal(baseboard(p, p.rooms[0]), 44 - 3);
  p.rooms[0].flooring = { noBaseWalls: [0], quarterRound: true };
  assert.equal(baseboard(p, p.rooms[0]), 44 - 3 - 12);
  p.rooms[0].flooring = { noBaseWalls: [1] };
  assert.equal(baseboard(p, p.rooms[0]), 34);
  p.rooms[0].flooring = { noBaseWalls: [0], quarterRound: true };
  const m = materials(p);
  assert.equal(m.quarterRound, 29);
});

test("transitions: shared doorway counts once, auto type by materials, override", () => {
  const p = prop();
  // A's right wall (index 1, x=12) and B's left wall (index 3, from (12,10) up to (12,0)).
  p.openings = [
    { id: "da", roomId: "a", kind: "opening", wall: 1, offset: 5, width: 3 },
    { id: "db", roomId: "b", kind: "door", wall: 3, offset: 5, width: 3 },
    { id: "front", roomId: "b", kind: "door", wall: 0, offset: 5, width: 3 },
  ];
  p.rooms[1].flooring = { material: "hard" };
  let t = transitions(p);
  assert.equal(t.length, 2);
  assert.equal(t[0].type, "carpet-tile");
  assert.equal(t[0].otherRoomId, "b");
  assert.equal(t[1].type, "threshold");
  p.rooms[0].flooring = { material: "hard" };
  assert.equal(transitions(p)[0].type, "t-mold");
  p.openings[1].transition = "reducer";
  t = transitions(p);
  assert.equal(t[0].type, "reducer");
  assert.equal(t[0].auto, false);
  const m = materials(p);
  assert.deepEqual(
    m.transitionTotals.sort((a, b) => a.type.localeCompare(b.type)),
    [
      { type: "reducer", count: 1, length: 3 },
      { type: "threshold", count: 1, length: 3 },
    ],
  );
});

function carpetDefaults() {
  return {
    material: "carpet" as const,
    rollWidthFt: 12,
    pileDeg: 0,
    trimIn: 3,
    wastePct: 5,
    noBaseWalls: [],
    quarterRound: false,
    seamOffsetFt: 0,
    plankDeg: 0,
  };
}
