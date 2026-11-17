import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { edges, rectPoints } from "./model.ts";
import { labelOffsetPx, layoutWallLabels } from "./wall-labels.ts";

describe("wall labels stay on their wall", () => {
  const view = { scale: 12, tx: 40, ty: 40 };

  it("places every wall just outside a fitted room", () => {
    const spots = layoutWallLabels(edges(rectPoints(0, 0, 12, 10)), view, [], { top: 4, bottom: 500, left: 4, right: 400 }, [], []);
    assert.equal(spots.length, 4);
    for (const spot of spots) {
      assert.ok(labelOffsetPx(spot, view) <= 28, `offset ${labelOffsetPx(spot, view)}`);
      assert.equal(spot.leader, false);
    }
  });

  it("keeps a label when the outside of the wall is the next room", () => {
    const room = rectPoints(0, 0, 12, 10);
    const neighbor = rectPoints(12, 0, 8, 10);
    const spots = layoutWallLabels(edges(room), view, [], { top: 4, bottom: 500, left: 4, right: 400 }, [neighbor], []);
    assert.equal(spots.length, 4);
    const right = spots.find((s) => s.e.index === 1)!;
    assert.ok(right.x < 12, "shared wall label should sit inside the room");
    for (const spot of spots) assert.ok(labelOffsetPx(spot, view) <= 28);
  });

  it("still returns a chip when chrome covers the outside", () => {
    const spots = layoutWallLabels(
      edges(rectPoints(0, 0, 12, 10)),
      view,
      [],
      { top: 4, bottom: 200, left: 4, right: 200 },
      [],
      [{ l: 0, t: 140, r: 400, b: 220 }],
    );
    assert.equal(spots.length, 4);
    for (const spot of spots) assert.ok(labelOffsetPx(spot, view) <= 28);
  });
});
