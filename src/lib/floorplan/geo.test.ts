import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alignNorthArrow, bearingDegrees, haversineMeters, trackSpan } from "./geo.ts";
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
    rooms: [
      { id: "room-bed", name: "Bedroom", type: "bedroom", x: 0, y: 0, w: 10, h: 12 },
      { id: "room-living", name: "Living room", type: "living", x: 10, y: 0, w: 12, h: 12 },
    ],
    openings: [
      { id: "open-bed", kind: "door", roomId: "room-bed", wall: "n", offset: 2, width: 3, swing: "in-left" },
      { id: "open-living", kind: "door", roomId: "room-living", wall: "e", offset: 2, width: 3, swing: "in-left" },
    ],
    furniture: [],
    notes: "",
    sourceKind: "photos",
    sourceCount: 3,
    confidence: 0.8,
    ...overrides,
  };
}

describe("alignNorthArrow", () => {
  it("matches the entry door by room name/type, not the opaque room id", () => {
    // Entry heading 180° (south) on the living room's east door:
    // north = 180 − 90 (east wall faces 90°) = 90.
    // The old code tested the regex against room ids ("room-bed",
    // "room-living"), matched neither, and fell back to the first door
    // (bedroom, north wall) giving 180 − 0 = 180.
    const aligned = alignNorthArrow(
      plan({
        headings: [{ at: 1, heading: 180, label: "Entry", spaceId: "room-living" }],
      }),
    );
    assert.equal(aligned.northAngle, 90);
  });

  it("falls back to the first door when no room looks like an entry", () => {
    const aligned = alignNorthArrow(
      plan({
        rooms: [{ id: "room-x", name: "Office", type: "office", x: 0, y: 0, w: 10, h: 10 }],
        openings: [{ id: "open-x", kind: "door", roomId: "room-x", wall: "s", offset: 2, width: 3, swing: "in-left" }],
        headings: [{ at: 1, heading: 90, label: "Entry", spaceId: "room-x" }],
      }),
    );
    assert.equal(aligned.northAngle, 270);
  });
});

describe("haversineMeters / bearingDegrees", () => {
  it("measures about 111 km per degree of latitude", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(d - 111_195) < 200, `got ${d}`);
  });

  it("bears north at 0° and east at 90°", () => {
    assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })), 0);
    assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })), 90);
  });
});

describe("trackSpan", () => {
  it("returns null for a track too short to span anything", () => {
    assert.equal(trackSpan([{ lat: 0, lng: 0 }]), null);
    assert.equal(
      trackSpan([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0 },
      ]),
      null,
    );
  });

  it("measures the span of a walked rectangle", () => {
    const span = trackSpan([
      { lat: 51.5, lng: -0.12 },
      { lat: 51.5, lng: -0.11 },
      { lat: 51.51, lng: -0.11 },
      { lat: 51.51, lng: -0.12 },
    ]);
    assert.ok(span);
    assert.ok(span.widthM > 500 && span.widthM < 900, `width ${span.widthM}`);
    assert.ok(span.depthM > 900 && span.depthM < 1300, `depth ${span.depthM}`);
  });
});
