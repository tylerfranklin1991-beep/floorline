import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { edges, rectPoints } from "./model.ts";
import {
  frameInFreeArea,
  labelOffsetPx,
  labelScreenBox,
  layoutCaptions,
  layoutWallLabels,
  roomScreenBox,
  zoomAbout,
  type ScreenBox,
} from "./wall-labels.ts";

function overlap(a: ScreenBox, b: ScreenBox) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

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

  it("does not cover the room name when the outside of a side wall is blocked", () => {
    const viewSmall = { scale: 12, tx: 40, ty: 60 };
    const room = rectPoints(0, 0, 6, 5);
    const neighbor = rectPoints(6, 0, 6, 5);
    const caps = layoutCaptions(
      [{ id: "r", points: room, name: "Room 7", area: "30 sq ft", closet: false, holes: [] }],
      viewSmall,
    );
    const name = caps.get("r");
    assert.ok(name);
    const spots = layoutWallLabels(
      edges(room),
      viewSmall,
      [name.box],
      { top: 4, bottom: 500, left: 4, right: 500 },
      [neighbor],
      [],
    );
    const side = spots.find((s) => s.e.index === 1);
    assert.ok(side);
    assert.ok(labelOffsetPx(side, viewSmall) <= 28);
    assert.equal(overlap(labelScreenBox(side, viewSmall), name.box), false);
    for (const spot of spots) assert.equal(overlap(labelScreenBox(spot, viewSmall), name.box), false);
  });

  it("keeps a closet wall label off the closet text", () => {
    const viewSmall = { scale: 18, tx: 24, ty: 30 };
    const parent = rectPoints(0, 0, 12, 10);
    const closet = rectPoints(12, 3, 4, 4);
    const caps = layoutCaptions(
      [
        { id: "c", points: closet, name: "Closet", area: "16 sq ft", closet: true, holes: [] },
        { id: "p", points: parent, name: "Room 7", area: "120 sq ft", closet: false, holes: [closet] },
      ],
      viewSmall,
    );
    const closetCap = caps.get("c");
    const parentCap = caps.get("p");
    assert.ok(closetCap);
    assert.ok(parentCap);
    const spots = layoutWallLabels(
      edges(closet),
      viewSmall,
      [closetCap.box, parentCap.box],
      { top: 0, bottom: 900, left: 0, right: 900 },
      [parent],
      [],
    );
    assert.equal(spots.length, 4);
    for (const spot of spots) {
      assert.ok(labelOffsetPx(spot, viewSmall) <= 28);
      assert.equal(overlap(labelScreenBox(spot, viewSmall), closetCap.box), false);
      assert.equal(overlap(labelScreenBox(spot, viewSmall), parentCap.box), false);
    }
  });

  it("labels a shared wall once", () => {
    const a = rectPoints(0, 0, 10, 8);
    const b = rectPoints(10, 0, 10, 8);
    const limits = { top: 4, bottom: 500, left: 4, right: 500 };
    const claimed: { x: number; y: number; length: number; horizontal: boolean }[] = [];
    const first = layoutWallLabels(edges(a), view, [], limits, [b], [], claimed);
    const second = layoutWallLabels(edges(b), view, [], limits, [a], [], claimed);
    const onShared = [...first, ...second].filter((s) => {
      const mid = (s.e.a.x + s.e.b.x) / 2;
      return Math.abs(mid - 10) < 0.2 && !s.e.horizontal;
    });
    assert.equal(onShared.length, 1);
  });
});

describe("room and closet captions", () => {
  it("hides a closet that is too small and keeps the parent off it", () => {
    const parent = rectPoints(0, 0, 12, 10);
    const closet = rectPoints(12, 4, 1.2, 2);
    const view = { scale: 10, tx: 20, ty: 30 };
    const caps = layoutCaptions(
      [
        { id: "c", points: closet, name: "Closet", area: "6 sq ft", closet: true, holes: [] },
        { id: "p", points: parent, name: "Room 7", area: "106 sq ft", closet: false, holes: [closet] },
      ],
      view,
    );
    assert.equal(caps.get("c"), null);
    const parentCap = caps.get("p");
    assert.ok(parentCap);
    const closetScreen = {
      l: view.tx + 12 * view.scale,
      t: view.ty + 4 * view.scale,
      r: view.tx + 13.2 * view.scale,
      b: view.ty + 6 * view.scale,
    };
    assert.equal(overlap(parentCap.box, closetScreen), false);
  });

  it("fits closet text inside a larger closet without touching the parent", () => {
    const parent = rectPoints(0, 0, 12, 10);
    const closet = rectPoints(12, 3, 4, 4);
    const view = { scale: 16, tx: 24, ty: 24 };
    const caps = layoutCaptions(
      [
        { id: "c", points: closet, name: "Closet", area: "16 sq ft", closet: true, holes: [] },
        { id: "p", points: parent, name: "Room 7", area: "120 sq ft", closet: false, holes: [closet] },
      ],
      view,
    );
    const closetCap = caps.get("c");
    const parentCap = caps.get("p");
    assert.ok(closetCap);
    assert.ok(parentCap);
    const padded = { l: closetCap.box.l - 4, t: closetCap.box.t - 4, r: closetCap.box.r + 4, b: closetCap.box.b + 4 };
    assert.equal(overlap(parentCap.box, padded), false);
  });
});

describe("square up frame and zoom anchor", () => {
  it("keeps the room inside the area below the zoom row and above the panel", () => {
    const bounds = { minX: 0, minY: 0, w: 12, h: 10 };
    const canvas = { w: 384, h: 520 };
    const chrome = { top: 64, right: 8, bottom: 140, left: 8 };
    const labelPad = 32;
    const view = frameInFreeArea(bounds, canvas, {
      top: chrome.top + labelPad,
      right: chrome.right + labelPad,
      bottom: chrome.bottom + labelPad,
      left: chrome.left + labelPad,
    });
    const box = roomScreenBox(bounds, view);
    assert.ok(box.t - 22 >= chrome.top - 0.5, `label top ${box.t - 22}`);
    assert.ok(box.b + 22 <= canvas.h - chrome.bottom + 0.5, `label bottom ${box.b + 22}`);
    assert.ok(box.l - 22 >= chrome.left - 0.5);
    assert.ok(box.r + 22 <= canvas.w - chrome.right + 0.5);
  });

  it("zooms about the selected room so its center stays put", () => {
    const view = { scale: 10, tx: 40, ty: 50 };
    const anchor = { x: 160, y: 180 };
    const next = zoomAbout(view, anchor, 1.4);
    const before = { x: (anchor.x - view.tx) / view.scale, y: (anchor.y - view.ty) / view.scale };
    const after = { x: (anchor.x - next.tx) / next.scale, y: (anchor.y - next.ty) / next.scale };
    assert.ok(Math.abs(before.x - after.x) < 1e-6);
    assert.ok(Math.abs(before.y - after.y) < 1e-6);
    assert.ok(next.scale > view.scale);
  });
});
