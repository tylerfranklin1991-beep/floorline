import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ArScanner, roomOutline, wallFrameAngle, type ArFrame, type ArPlane } from "./arscan.ts";
import { bbox } from "./model.ts";

let nid = 1;
/** Vertical wall plane at constant world x (normal along x) or z, spanning [lo, hi]. */
function wall(axis: "x" | "z", v: number, lo: number, hi: number, inward: 1 | -1, a = 0): ArPlane {
  const pts =
    axis === "x"
      ? [
          [v, 0, lo],
          [v, 0, hi],
          [v, 2.4, hi],
          [v, 2.4, lo],
        ]
      : [
          [lo, 0, v],
          [hi, 0, v],
          [hi, 2.4, v],
          [lo, 2.4, v],
        ];
  const n = axis === "x" ? [inward, 0, 0] : [0, 0, inward];
  const r = (x: number, z: number) => [
    x * Math.cos(a) - z * Math.sin(a),
    x * Math.sin(a) + z * Math.cos(a),
  ];
  const c = axis === "x" ? [v, (lo + hi) / 2] : [(lo + hi) / 2, v];
  const [cx, cz] = r(c[0], c[1]);
  const [nx, nz] = r(n[0], n[2]);
  return {
    id: nid++,
    type: "VERTICAL",
    cx,
    cy: 1.2,
    cz,
    nx,
    ny: 0,
    nz,
    ex: hi - lo,
    ez: 2.4,
    polygon: pts.map((p) => {
      const [x, z] = r(p[0], p[2]);
      return [x, p[1], z];
    }),
  };
}
function floor(x0: number, z0: number, x1: number, z1: number): ArPlane {
  return {
    id: nid++,
    type: "HORIZONTAL_UPWARD_FACING",
    cx: (x0 + x1) / 2,
    cy: 0,
    cz: (z0 + z1) / 2,
    nx: 0,
    ny: 1,
    nz: 0,
    ex: x1 - x0,
    ez: z1 - z0,
    polygon: [
      [x0, 0, z0],
      [x1, 0, z0],
      [x1, 0, z1],
      [x0, 0, z1],
    ],
  };
}
const frame = (x: number, z: number, planes: ArPlane[]): ArFrame => ({
  tracking: "TRACKING",
  pose: { x, y: 1.4, z, fx: 1, fy: 0, fz: 0 },
  planes,
});

describe("wallFrameAngle", () => {
  it("finds the wall axis, folded to [-45°, 45°)", () => {
    const a = (20 * Math.PI) / 180;
    const ws = [wall("x", 0, 0, 4, 1, a), wall("z", 0, 0, 3, 1, a), wall("x", 4, 0, 4, -1, a)];
    assert.ok(Math.abs(wallFrameAngle(ws)! - a) < 1e-6);
    assert.equal(wallFrameAngle([floor(0, 0, 1, 1)]), null);
  });
});

describe("roomOutline", () => {
  it("uses the nearest wall on each side of the walked area", () => {
    const planes = [
      wall("x", 0, 0, 3, 1),
      wall("x", 4, 0, 3, -1),
      wall("z", 0, 0, 4, 1),
      wall("z", 3, 0, 4, -1),
      wall("x", 7, 0, 3, -1), // the next room's far wall: ignored, a nearer one exists
    ];
    const r = roomOutline(
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 2 },
        { x: 1, y: 2 },
      ],
      planes,
      0,
    )!;
    assert.deepEqual(r.sides, ["wall", "wall", "wall", "wall"]);
    const b = bbox(r.points);
    assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY], [0, 4, 0, 3]);
  });

  it("falls back to floor extents, then to the path plus a margin", () => {
    const r = roomOutline(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1.5 },
      ],
      [floor(0, 0, 3.5, 1.2), wall("x", 0, 0, 3, 1)],
      0,
      { margin: 0.4 },
    )!;
    assert.deepEqual(r.sides, ["wall", "floor", "floor", "path"]);
    const b = bbox(r.points);
    assert.ok(Math.abs(b.maxX - 3.5) < 1e-9);
    assert.ok(Math.abs(b.minY) < 1e-9);
    assert.ok(Math.abs(b.maxY - 1.95) < 1e-9, String(b.maxY));
  });

  it("snaps to the grid", () => {
    const r = roomOutline([{ x: 1.03, y: 1.07 }], [], 0, { grid: 0.1 })!;
    for (const p of r.points) {
      assert.ok(Math.abs(p.x * 10 - Math.round(p.x * 10)) < 1e-9);
      assert.ok(Math.abs(p.y * 10 - Math.round(p.y * 10)) < 1e-9);
    }
  });
});

describe("ArScanner", () => {
  it("builds two square rooms in a rotated house with a room break", () => {
    const a = (15 * Math.PI) / 180;
    const R = (x: number, z: number): [number, number] => [
      x * Math.cos(a) - z * Math.sin(a),
      x * Math.sin(a) + z * Math.cos(a),
    ];
    // Room A: x 0..4, Room B: x 4..7 (shared wall at 4), both z 0..3.
    const planes = [
      wall("x", 0, 0, 3, 1, a),
      wall("x", 4, 0, 3, -1, a),
      wall("x", 7, 0, 3, -1, a),
      wall("z", 0, 0, 7, 1, a),
      wall("z", 3, 0, 7, -1, a),
    ];
    const s = new ArScanner();
    s.push({ ...frame(0, 0, planes), tracking: "PAUSED" }); // ignored
    for (const [x, z] of [
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
      [3.6, 1.5],
    ])
      s.push(frame(...R(x, z), planes));
    const first = s.newRoom(0.1)!;
    assert.ok(first.door);
    for (const [x, z] of [
      [4.5, 1.5],
      [6.5, 1],
      [6.5, 2],
    ])
      s.push(frame(...R(x, z), planes));
    const rooms = s.finish(0.1);
    assert.equal(rooms.length, 2);
    const [ba, bb] = rooms.map((r) => bbox(r.points));
    assert.ok(Math.abs(ba.w - 4) < 0.11 && Math.abs(ba.h - 3) < 0.11, JSON.stringify(ba));
    assert.ok(Math.abs(bb.w - 3) < 0.11 && Math.abs(bb.h - 3) < 0.11, JSON.stringify(bb));
    assert.ok(Math.abs(ba.maxX - bb.minX) < 0.11, "rooms share the wall");
    assert.deepEqual(rooms[1].sides, ["wall", "wall", "wall", "wall"]);
    s.undoRoom();
    assert.equal(s.rooms.length, 0);
  });
});
