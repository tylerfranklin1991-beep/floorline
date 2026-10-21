import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  area,
  bbox,
  convertProperty,
  edges,
  formatLength,
  isRectilinear,
  magnetOffset,
  moveCorner,
  newProperty,
  outlineFromWalk,
  parseLength,
  rectPoints,
  rectilinearize,
  sanitizeProperty,
  setWallLength,
} from "./model.ts";

describe("rectilinearize", () => {
  it("cleans a jittery, slightly rotated AR rectangle into a 12x10 box", () => {
    const a = (4 * Math.PI) / 180;
    const rot = (x: number, y: number) => ({
      x: x * Math.cos(a) - y * Math.sin(a) + 3,
      y: x * Math.sin(a) + y * Math.cos(a) - 2,
    });
    const raw = [rot(0, 0.1), rot(12.1, -0.1), rot(11.9, 10.05), rot(0.05, 9.9)];
    const out = rectilinearize(raw, 0.5);
    assert.ok(isRectilinear(out));
    assert.equal(out.length, 4);
    const box = bbox(out);
    assert.equal(box.w, 12);
    assert.equal(box.h, 10);
  });

  it("drops extra jitter corners along a straight wall", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 5, y: 0.2 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ];
    const out = rectilinearize(raw, 0.5);
    assert.equal(out.length, 4);
    assert.ok(isRectilinear(out));
  });

  it("keeps an L-shaped room as six walls", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 10.2, y: 0.1 },
      { x: 10, y: 5 },
      { x: 5.1, y: 5.1 },
      { x: 5, y: 10 },
      { x: -0.1, y: 10 },
    ];
    const out = rectilinearize(raw, 0.5);
    assert.equal(out.length, 6);
    assert.ok(isRectilinear(out));
    assert.equal(area(out), 75);
  });

  it("falls back to a rectangle for degenerate input", () => {
    const out = rectilinearize([
      { x: 0, y: 0 },
      { x: 4, y: 3 },
    ]);
    assert.ok(isRectilinear(out));
  });
});

describe("editing walls", () => {
  it("setWallLength resizes a rectangle and keeps it rectilinear", () => {
    const pts = rectPoints(0, 0, 10, 8);
    const out = setWallLength(pts, 0, 12.5);
    assert.ok(out);
    assert.ok(isRectilinear(out!));
    const lens = edges(out!).map((e) => e.length);
    assert.deepEqual(lens, [12.5, 8, 12.5, 8]);
  });

  it("setWallLength refuses to collapse a wall", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    assert.equal(setWallLength(L, 2, 10), null);
  });

  it("moveCorner drags adjacent walls", () => {
    const out = moveCorner(rectPoints(0, 0, 10, 8), 2, { x: 12, y: 9 });
    assert.ok(isRectilinear(out));
    assert.equal(bbox(out).w, 12);
    assert.equal(bbox(out).h, 9);
  });

  it("magnetOffset lines a room up with its neighbour", () => {
    const off = magnetOffset(rectPoints(10.3, 0.2, 5, 5), [rectPoints(0, 0, 10, 10)], 0.6);
    assert.deepEqual(off, { dx: -0.3, dy: -0.2 });
  });
});

describe("guided walk", () => {
  it("builds a closed rectangle from four walls", () => {
    const out = outlineFromWalk(
      [
        { length: 12, turn: "right" },
        { length: 10, turn: "right" },
        { length: 12, turn: "right" },
        { length: 10, turn: "right" },
      ],
      0.5,
    );
    assert.equal(out.length, 4);
    assert.equal(area(out), 120);
  });

  it("closes the loop when the user stops before the last wall", () => {
    const out = outlineFromWalk(
      [
        { length: 12, turn: "right" },
        { length: 10, turn: "right" },
        { length: 12, turn: "right" },
      ],
      0.5,
    );
    assert.ok(isRectilinear(out));
    assert.equal(area(out), 120);
  });
});

describe("lengths", () => {
  it("parses feet and inches in the ways people type them", () => {
    assert.equal(parseLength("12", "ft"), 12);
    assert.equal(parseLength("12.5", "ft"), 12.5);
    assert.equal(parseLength(`12' 6"`, "ft"), 12.5);
    assert.equal(parseLength("12'6", "ft"), 12.5);
    assert.equal(parseLength("12-6", "ft"), 12.5);
    assert.equal(parseLength(`6"`, "ft"), 0.5);
    assert.equal(parseLength("abc", "ft"), null);
    assert.equal(parseLength("3,2", "m"), 3.2);
    assert.equal(parseLength("320cm", "m"), 3.2);
  });

  it("formats feet and inches", () => {
    assert.equal(formatLength(12.5, "ft"), `12'-6"`);
    assert.equal(formatLength(10, "ft"), `10'`);
    assert.equal(formatLength(3.2, "m"), "3.20 m");
  });

  it("converts a property between units", () => {
    const p = newProperty("Test");
    p.rooms.push({
      id: "r",
      name: "A",
      points: rectPoints(0, 0, 10, 10),
      photos: [],
      notes: "",
      source: "draw",
    });
    const m = convertProperty(p, "m");
    assert.equal(m.rooms[0].points[2].x, 3.05);
  });

  it("sanitizes junk JSON", () => {
    assert.equal(sanitizeProperty(null), null);
    const ok = sanitizeProperty({
      id: "p",
      rooms: [{ id: "r", points: [{ x: 0, y: 0 }] }],
      openings: [{ roomId: "zzz" }],
    });
    assert.equal(ok?.rooms.length, 0);
    assert.equal(ok?.openings.length, 0);
  });
});
