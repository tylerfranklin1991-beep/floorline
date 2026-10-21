import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  compassHeading,
  HeadingFilter,
  roomFromTrace,
  simplify,
  StepDetector,
  strideFromCalibration,
} from "./deadreckon.ts";
import { bbox, isRectilinear } from "./model.ts";

describe("StepDetector", () => {
  it("counts one step per bounce of a ~2 Hz walking signal", () => {
    const d = new StepDetector();
    let steps = 0;
    for (let t = 0; t < 10_000; t += 20) {
      const m = 9.81 + 2.5 * Math.sin((2 * Math.PI * 2 * t) / 1000) + (Math.random() - 0.5) * 0.3;
      if (d.push(m, t)) steps += 1;
    }
    assert.ok(steps >= 17 && steps <= 22, `got ${steps}`);
  });
  it("ignores a phone lying still", () => {
    const d = new StepDetector();
    let steps = 0;
    for (let t = 0; t < 5000; t += 20)
      if (d.push(9.81 + (Math.random() - 0.5) * 0.2, t)) steps += 1;
    assert.equal(steps, 0);
  });
});

describe("heading", () => {
  it("reads alpha as counter-clockwise and prefers webkitCompassHeading", () => {
    assert.equal(compassHeading({ alpha: 90 }), 270);
    assert.equal(compassHeading({ alpha: 90, webkitCompassHeading: 12 }), 12);
    assert.equal(compassHeading({ alpha: null }), null);
  });
  it("smooths across the 0/360 wrap", () => {
    const f = new HeadingFilter(0.5);
    f.push(350);
    const v = f.push(10);
    assert.ok(v > 355 || v < 5, `got ${v}`);
  });
});

describe("tracing a room", () => {
  it("walking a noisy 12x10 loop gives a rectilinear room near where it was walked", () => {
    let p = { x: 5, y: 5 };
    const trace = [p];
    const legs: [number, number][] = [
      [0, 12],
      [90, 10],
      [180, 12],
      [270, 10],
    ];
    for (const [h, len] of legs)
      for (let s = 0; s < len / 2; s += 1) {
        p = advance(p, h + (Math.random() - 0.5) * 8, 2);
        trace.push(p);
      }
    const room = roomFromTrace(trace, { tolerance: 1.5, grid: 0.5, frameAngle: 0, minSize: 2 });
    assert.ok(room);
    assert.ok(isRectilinear(room));
    const b = bbox(room);
    assert.ok(Math.abs(b.w - 12) < 2 && Math.abs(b.h - 10) < 2, JSON.stringify(b));
    assert.ok(Math.abs(b.minX - 5) < 2 && Math.abs(b.minY - 5) < 2);
  });
  it("rejects a trace that is basically standing still", () => {
    const t = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.2 },
      { x: 0.3, y: 0.6 },
    ];
    assert.equal(roomFromTrace(t, { tolerance: 1, grid: 0.5, frameAngle: 0, minSize: 2 }), null);
  });
  it("simplify keeps corners and drops jitter", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    assert.equal(simplify(pts, 0.5).length, 3);
  });
  it("stride calibration", () => {
    assert.equal(strideFromCalibration(20, 8), 2.5);
    assert.equal(strideFromCalibration(20, 0), null);
  });
});
