import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newProperty, rectPoints } from "./model.ts";
import { renderPlanSvg } from "./render.ts";

describe("renderPlanSvg", () => {
  it("draws rooms, wall lengths, openings and photo thumbnails", () => {
    const p = newProperty("12 Oak <St>");
    p.rooms.push({
      id: "r1",
      name: "Kitchen",
      points: rectPoints(0, 0, 12, 10),
      photos: [{ id: "ph", thumb: "data:image/jpeg;base64,AAAA", takenAt: 0 }],
      notes: "",
      source: "draw",
      levelId: "level-main",
    });
    p.openings.push({ id: "o", roomId: "r1", kind: "door", wall: 0, offset: 3, width: 2.67 });
    const svg = renderPlanSvg(p);
    assert.match(svg, /^<svg /);
    assert.match(svg, /Kitchen/);
    assert.match(svg, /12 Oak &lt;St&gt;/);
    assert.match(svg, /120 sq ft/);
    assert.match(svg, /12'/);
    assert.match(svg, /10'/);
    assert.match(svg, /data:image\/jpeg/);
    assert.match(svg, / A2\.67 /);
  });
});
