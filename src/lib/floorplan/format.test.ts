import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accuracyLabel,
  accuracyNote,
  convertPlan,
  formatLength,
  measureFootprint,
  planBounds,
  sheetLayout,
} from "./format.ts";
import type { FloorPlan } from "./types.ts";

function plan(overrides: Partial<FloorPlan> = {}): FloorPlan {
  return {
    id: "plan-1",
    title: "Test plan",
    createdAt: 0,
    units: "ft",
    overallWidth: 30,
    overallDepth: 20,
    northAngle: 0,
    rooms: [{ id: "room-1", name: "Living room", type: "living", x: 0, y: 0, w: 12, h: 14 }],
    openings: [],
    furniture: [],
    notes: "",
    sourceKind: "photos",
    sourceCount: 3,
    confidence: 0.8,
    ...overrides,
  };
}

describe("formatLength", () => {
  it("formats feet and inches", () => {
    assert.equal(formatLength(12, "ft"), "12'");
    assert.equal(formatLength(12.5, "ft"), "12'-6\"");
  });

  it("formats metres with one decimal", () => {
    assert.equal(formatLength(4, "m"), "4 m");
    assert.equal(formatLength(4.25, "m"), "4.3 m");
  });
});

describe("convertPlan", () => {
  it("converts room and opening lengths but keeps metre-based references in metres", () => {
    const converted = convertPlan(
      plan({
        rooms: [{ id: "room-1", name: "Living room", type: "living", x: 0, y: 0, w: 10, h: 12 }],
        openings: [{ id: "open-1", kind: "door", roomId: "room-1", wall: "n", offset: 2, width: 3, swing: "in-left" }],
        measurementBasis: "measured",
        scaleReference: { kind: "disto", meters: 3.05, label: "Living room width" },
        measuredDimensions: [{ roomId: "room-1", axis: "w", meters: 3.05, at: 1 }],
      }),
      "m",
    );
    assert.equal(converted.units, "m");
    assert.equal(converted.rooms[0].w, 3.05);
    assert.equal(converted.openings[0].width, 0.91);
    assert.equal(converted.measurementBasis, "measured");
    assert.equal(converted.scaleReference?.meters, 3.05);
    assert.equal(converted.measuredDimensions?.[0].meters, 3.05);
  });

  it("returns the same plan when units already match", () => {
    const original = plan();
    assert.equal(convertPlan(original, "ft"), original);
  });
});

describe("planBounds", () => {
  it("keeps the real bounds of a small but valid plan", () => {
    const bounds = planBounds(
      plan({
        overallWidth: 3,
        overallDepth: 2,
        rooms: [{ id: "room-1", name: "Nook", type: "other", x: 0, y: 0, w: 3, h: 2 }],
      }),
    );
    assert.equal(bounds.w, 3);
    assert.equal(bounds.h, 2);
  });

  it("falls back to a unit-aware minimal sheet only for a degenerate plan", () => {
    const feet = planBounds(plan({ rooms: [], furniture: [], overallWidth: 0, overallDepth: 0 }));
    assert.deepEqual([feet.w, feet.h], [20, 16]);
    const metres = planBounds(
      plan({ units: "m", rooms: [], furniture: [], overallWidth: 0, overallDepth: 0 }),
    );
    assert.deepEqual([metres.w, metres.h], [6, 5]);
  });
});

describe("measureFootprint", () => {
  it("accounts for negative coordinates", () => {
    const result = measureFootprint(
      [{ id: "room-1", name: "A", type: "living", x: -5, y: -2, w: 10, h: 8 }],
      [],
    );
    assert.deepEqual(result, { overallWidth: 10, overallDepth: 8 });
  });

  it("uses a unit-aware minimum footprint", () => {
    assert.deepEqual(measureFootprint([], []), { overallWidth: 4, overallDepth: 4 });
    assert.deepEqual(measureFootprint([], [], "m"), { overallWidth: 1.2, overallDepth: 1.2 });
  });
});

describe("sheetLayout", () => {
  it("uses metric margins in metric mode, not 2.4 m", () => {
    const feet = sheetLayout(plan());
    const metres = sheetLayout(plan({ units: "m" }));
    assert.equal(feet.w, 30 + 2.4 * 2);
    assert.equal(metres.w, 30 + 0.75 * 2);
    assert.equal(metres.titleY, 20 + 0.17);
  });
});

describe("accuracyLabel / accuracyNote", () => {
  it("labels a traced plan estimated", () => {
    assert.equal(accuracyLabel(plan()), "Estimated plan");
    assert.match(accuracyNote(plan()), /verify with a tape/);
  });

  it("labels a plan partly measured when some rooms have laser shots", () => {
    const partly = plan({
      rooms: [
        { id: "room-1", name: "Living room", type: "living", x: 0, y: 0, w: 12, h: 14 },
        { id: "room-2", name: "Bedroom", type: "bedroom", x: 12, y: 0, w: 10, h: 12 },
      ],
      measuredDimensions: [{ roomId: "room-1", axis: "w", meters: 3.66, at: 1 }],
    });
    assert.equal(accuracyLabel(partly), "Partly measured · 1 of 2 rooms laser-measured");
  });

  it("labels a fully laser-anchored plan measured", () => {
    assert.equal(accuracyLabel(plan({ measurementBasis: "measured" })), "Measured plan");
  });
});
