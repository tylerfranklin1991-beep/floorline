import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, normalizePlan } from "./normalize.ts";

function rawPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Test plan",
    units: "ft",
    overallWidth: 30,
    overallDepth: 20,
    northAngle: 0,
    notes: "",
    confidence: 0.8,
    rooms: [
      { id: "room-living", name: "Living room", type: "living", x: 0, y: 0, w: 12, h: 14 },
      { id: "room-bed", name: "Bedroom", type: "bedroom", x: 12, y: 0, w: 10, h: 12 },
    ],
    openings: [
      { id: "open-1", kind: "door", roomId: "room-living", wall: "s", offset: 2, width: 3, swing: "in-left" },
    ],
    furniture: [{ id: "furn-1", kind: "sofa", label: "Sofa", x: 2, y: 2, w: 6, h: 3, rotation: 0 }],
    ...overrides,
  };
}

const FT_META = { sourceKind: "photos", sourceCount: 3, units: "ft" } as const;
const M_META = { sourceKind: "photos", sourceCount: 3, units: "m" } as const;

describe("normalizePlan units", () => {
  it("keeps a 0.9 m closet in metric mode and drops a 0.5 m sliver", () => {
    const plan = normalizePlan(
      rawPlan({
        units: "m",
        overallWidth: 10,
        overallDepth: 8,
        rooms: [
          { id: "room-closet", name: "Closet", type: "closet", x: 0, y: 0, w: 0.9, h: 2 },
          { id: "room-sliver", name: "Sliver", type: "other", x: 1, y: 0, w: 0.5, h: 2 },
          { id: "room-main", name: "Living room", type: "living", x: 2, y: 0, w: 4, h: 5 },
        ],
        openings: [],
        furniture: [],
      }),
      M_META,
    );
    assert.deepEqual(
      plan.rooms.map((room) => room.id).sort(),
      ["room-closet", "room-main"],
    );
  });

  it("drops a 2 ft wide room in imperial mode (below the 0.9 m minimum)", () => {
    const plan = normalizePlan(
      rawPlan({
        rooms: [
          { id: "room-narrow", name: "Nook", type: "other", x: 0, y: 0, w: 2, h: 10 },
          { id: "room-main", name: "Living room", type: "living", x: 3, y: 0, w: 12, h: 14 },
        ],
        openings: [],
        furniture: [],
      }),
      FT_META,
    );
    assert.deepEqual(
      plan.rooms.map((room) => room.id),
      ["room-main"],
    );
  });

  it("uses a metric default opening width (0.8 m), not 2.5 m", () => {
    const plan = normalizePlan(
      rawPlan({
        units: "m",
        overallWidth: 10,
        overallDepth: 8,
        rooms: [{ id: "room-main", name: "Living room", type: "living", x: 0, y: 0, w: 5, h: 5 }],
        openings: [{ id: "open-1", kind: "door", roomId: "room-main", wall: "n", offset: 1, swing: "in-left" }],
        furniture: [],
      }),
      M_META,
    );
    assert.equal(plan.openings[0].width, 0.8);
  });
});

describe("normalizePlan geometric validation", () => {
  it("warns about overlapping rooms instead of silently keeping them", () => {
    const plan = normalizePlan(
      rawPlan({
        rooms: [
          { id: "room-a", name: "Living room", type: "living", x: 0, y: 0, w: 12, h: 12 },
          { id: "room-b", name: "Kitchen", type: "kitchen", x: 6, y: 0, w: 12, h: 12 },
        ],
        openings: [],
        furniture: [],
      }),
      FT_META,
    );
    assert.equal(plan.rooms.length, 2);
    assert.ok(plan.validationWarnings?.some((w) => w.includes("overlap by about")));
  });

  it("clamps an opening wider than its wall and warns", () => {
    const plan = normalizePlan(
      rawPlan({
        rooms: [{ id: "room-main", name: "Living room", type: "living", x: 0, y: 0, w: 10, h: 12 }],
        openings: [
          { id: "open-1", kind: "door", roomId: "room-main", wall: "n", offset: 0, width: 12, swing: "in-left" },
        ],
        furniture: [],
      }),
      FT_META,
    );
    assert.equal(plan.openings[0].width, 10);
    assert.ok(plan.validationWarnings?.some((w) => w.includes("wider than")));
  });

  it("moves an opening that extends past its wall and warns", () => {
    const plan = normalizePlan(
      rawPlan({
        rooms: [{ id: "room-main", name: "Living room", type: "living", x: 0, y: 0, w: 10, h: 12 }],
        openings: [
          { id: "open-1", kind: "door", roomId: "room-main", wall: "n", offset: 9, width: 2, swing: "in-left" },
        ],
        furniture: [],
      }),
      FT_META,
    );
    assert.equal(plan.openings[0].offset, 8);
    assert.ok(plan.validationWarnings?.some((w) => w.includes("extended past")));
  });

  it("warns about furniture that is not inside any room", () => {
    const plan = normalizePlan(
      rawPlan({
        furniture: [{ id: "furn-1", kind: "sofa", label: "Sofa", x: 20, y: 20, w: 6, h: 3, rotation: 0 }],
      }),
      FT_META,
    );
    assert.ok(plan.validationWarnings?.some((w) => w.includes('Furniture "Sofa" is not inside any room')));
  });

  it("renames duplicate room ids and warns", () => {
    const plan = normalizePlan(
      rawPlan({
        rooms: [
          { id: "room-dup", name: "Living room", type: "living", x: 0, y: 0, w: 12, h: 12 },
          { id: "room-dup", name: "Kitchen", type: "kitchen", x: 12, y: 0, w: 10, h: 12 },
        ],
        openings: [],
        furniture: [],
      }),
      FT_META,
    );
    assert.equal(new Set(plan.rooms.map((room) => room.id)).size, 2);
    assert.ok(plan.validationWarnings?.some((w) => w.includes("Duplicate room id")));
  });

  it("warns when rooms cover only a small part of the stated footprint", () => {
    const plan = normalizePlan(
      rawPlan({
        overallWidth: 30,
        overallDepth: 20,
        rooms: [{ id: "room-main", name: "Living room", type: "living", x: 0, y: 0, w: 10, h: 10 }],
        openings: [],
        furniture: [],
      }),
      FT_META,
    );
    assert.ok(plan.validationWarnings?.some((w) => w.includes("cover only about")));
  });
});

describe("normalizePlan honesty labels", () => {
  it("marks a plan estimated by default and measured with a DISTO scale reference", () => {
    const estimated = normalizePlan(rawPlan(), FT_META);
    assert.equal(estimated.measurementBasis, "estimated");
    assert.equal(estimated.scaleReference, null);

    const measured = normalizePlan(rawPlan(), {
      ...FT_META,
      scaleReference: { kind: "disto", meters: 4.2, label: "Living room width" },
    });
    assert.equal(measured.measurementBasis, "measured");
    assert.equal(measured.scaleReference?.meters, 4.2);
  });

  it("does not silently default confidence: it records the source", () => {
    const withConfidence = normalizePlan(rawPlan({ confidence: 0.8 }), FT_META);
    assert.equal(withConfidence.confidence, 0.8);
    assert.equal(withConfidence.confidenceSource, "model");

    const { confidence: _dropped, ...withoutConfidence } = rawPlan();
    const defaulted = normalizePlan(withoutConfidence, FT_META);
    assert.equal(defaulted.confidence, 0.55);
    assert.equal(defaulted.confidenceSource, "default");
    assert.ok(defaulted.validationWarnings?.some((w) => w.includes("reported no confidence")));
  });

  it("warns when the GPS walk span disagrees with the traced footprint", () => {
    const plan = normalizePlan(rawPlan(), {
      ...FT_META,
      gpsSpan: { widthM: 50, depthM: 40 },
    });
    assert.ok(plan.validationWarnings?.some((w) => w.includes("GPS walk span")));
  });
});

describe("extractJsonObject", () => {
  it("extracts JSON from a fenced code block", () => {
    assert.deepEqual(extractJsonObject('```json\n{"a": 1}\n```'), { a: 1 });
  });

  it("throws when there is no JSON object", () => {
    assert.throws(() => extractJsonObject("no json here"), /did not return a plan/);
  });
});
