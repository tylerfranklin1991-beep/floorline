import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertProperty,
  levelView,
  newProperty,
  newRoom,
  newStairs,
  nextLevelName,
  rectPoints,
  removeLevel,
  rotateStairs,
  sanitizeProperty,
  stairsArrow,
  stairsLabel,
  stairsRect,
  stairsTreads,
} from "./model.ts";
import { renderLevelSvgs, renderPlanSvg } from "./render.ts";

function twoLevels() {
  const p = newProperty("House");
  p.levels.push({ id: "up", name: "2nd floor" });
  p.rooms.push(newRoom("Kitchen", rectPoints(0, 0, 10, 10), "draw", "level-main"));
  p.rooms.push(newRoom("Bedroom", rectPoints(0, 0, 12, 10), "draw", "up"));
  p.openings.push({
    id: "o",
    roomId: p.rooms[1].id,
    kind: "door",
    wall: 0,
    offset: 3,
    width: 2.67,
  });
  p.stairs.push({ ...newStairs("level-main", { x: 12, y: 5 }, "ft"), steps: 14, toLevelId: "up" });
  return p;
}

describe("levels", () => {
  it("new properties start with one Main level", () => {
    const p = newProperty("X");
    assert.deepEqual(p.levels, [{ id: "level-main", name: "Main" }]);
    assert.deepEqual(p.stairs, []);
  });

  it("migrates old saves (no levels) to a single Main level", () => {
    const old = {
      id: "p1",
      name: "Old",
      units: "ft",
      rooms: [{ id: "r1", name: "A", points: rectPoints(0, 0, 5, 5), photos: [], notes: "" }],
      openings: [],
    };
    const p = sanitizeProperty(old)!;
    assert.equal(p.levels.length, 1);
    assert.equal(p.levels[0].name, "Main");
    assert.equal(p.rooms[0].levelId, p.levels[0].id);
    assert.deepEqual(p.stairs, []);
  });

  it("round-trips levels and stairs through JSON backup", () => {
    const p = twoLevels();
    const back = sanitizeProperty(JSON.parse(JSON.stringify(p)))!;
    assert.deepEqual(back.levels, p.levels);
    assert.deepEqual(back.stairs, p.stairs);
    assert.equal(back.rooms[1].levelId, "up");
  });

  it("drops bad stairs fields and dangling level links on import", () => {
    const p = twoLevels() as unknown as Record<string, unknown>;
    p.stairs = [
      { id: "s", levelId: "gone", toLevelId: "gone", steps: 2.5, heading: "x", width: -1 },
    ];
    const back = sanitizeProperty(p)!;
    assert.equal(back.stairs[0].levelId, "level-main");
    assert.equal(back.stairs[0].toLevelId, null);
    assert.equal(back.stairs[0].steps, null);
    assert.equal(back.stairs[0].heading, "n");
    assert.equal(back.stairs[0].width, 3);
  });

  it("levelView shows only that level's rooms, openings and stairs", () => {
    const p = twoLevels();
    const main = levelView(p, "level-main");
    assert.deepEqual(
      main.rooms.map((r) => r.name),
      ["Kitchen"],
    );
    assert.equal(main.openings.length, 0);
    assert.equal(main.stairs.length, 1);
    const up = levelView(p, "up");
    assert.deepEqual(
      up.rooms.map((r) => r.name),
      ["Bedroom"],
    );
    assert.equal(up.openings.length, 1);
    assert.equal(up.stairs.length, 0);
  });

  it("removes a level with its rooms and unlinks stairs, but never the last level", () => {
    const p = removeLevel(twoLevels(), "up");
    assert.equal(p.levels.length, 1);
    assert.equal(p.rooms.length, 1);
    assert.equal(p.openings.length, 0);
    assert.equal(p.stairs[0].toLevelId, null);
    assert.equal(removeLevel(p, "level-main"), p);
  });

  it("suggests the next level name", () => {
    const p = newProperty("X");
    assert.equal(nextLevelName(p), "Basement");
    p.levels.push({ id: "b", name: "Basement" });
    assert.equal(nextLevelName(p), "2nd floor");
  });
});

describe("stairs", () => {
  it("labels with direction and the typed step count", () => {
    const s = newStairs("l", { x: 0, y: 0 }, "ft");
    assert.equal(stairsLabel(s), "UP");
    assert.equal(stairsLabel({ ...s, steps: 14 }), "UP 14");
    assert.equal(stairsLabel({ ...s, direction: "down", steps: 3 }), "DN 3");
  });

  it("is centred where you tap, 3 ft by 10 ft by default", () => {
    const s = newStairs("l", { x: 10, y: 10 }, "ft");
    assert.deepEqual(stairsRect(s), { x: 8.5, y: 5, w: 3, h: 10 });
  });

  it("draws one tread line between each typed step", () => {
    const s = { ...newStairs("l", { x: 0, y: 0 }, "ft"), steps: 14 };
    assert.equal(stairsTreads(s, "ft").length, 13);
    const t = stairsTreads(s, "ft")[0];
    assert.equal(t.a.y, t.b.y); // north-south run: horizontal treads
  });

  it("rotates about its centre and swaps the footprint", () => {
    const s = newStairs("l", { x: 10, y: 10 }, "ft");
    const r = rotateStairs(s);
    assert.equal(r.heading, "e");
    assert.deepEqual(stairsRect(r), { x: 5, y: 8.5, w: 10, h: 3 });
    const a = stairsArrow(r);
    assert.ok(a.to.x > a.from.x);
    assert.equal(rotateStairs(rotateStairs(rotateStairs(r))).heading, "n");
  });

  it("converts stairs with the property units", () => {
    const p = twoLevels();
    const m = convertProperty(p, "m");
    assert.equal(m.stairs[0].width, 0.91);
    assert.equal(m.stairs[0].length, 3.05);
  });
});

describe("level export", () => {
  it("renders one SVG per level with the level name and stairs label", () => {
    const svgs = renderLevelSvgs(twoLevels());
    assert.equal(svgs.length, 2);
    assert.match(svgs[0].svg, /House · Main/);
    assert.match(svgs[0].svg, /Kitchen/);
    assert.doesNotMatch(svgs[0].svg, /Bedroom/);
    assert.match(svgs[0].svg, /UP 14/);
    assert.match(svgs[0].svg, /to 2nd floor/);
    assert.match(svgs[1].svg, /House · 2nd floor/);
    assert.match(svgs[1].svg, /Bedroom/);
  });

  it("keeps a plain title for a single-level property", () => {
    const p = newProperty("Flat");
    p.rooms.push(newRoom("A", rectPoints(0, 0, 5, 5), "draw"));
    assert.doesNotMatch(renderPlanSvg(p, { levelId: "level-main" }), /·/);
  });
});
