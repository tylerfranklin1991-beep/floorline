import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSTRAINT_LADDER, describeCameraError, openRearCamera } from "./camera.ts";
import { angleDiff, HeadingFilter, snapToAxis, StepDetector } from "./deadreckon.ts";
import { newProperty } from "./model.ts";
import { uniqueId, validLevel } from "./store.ts";

const fakeStream = { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
const err = (name: string) => Object.assign(new Error(name), { name });

describe("camera open", () => {
  it("falls back down the constraint ladder to any camera", async () => {
    const seen: MediaStreamConstraints[] = [];
    const s = await openRearCamera(async (c) => {
      seen.push(c);
      if (seen.length < 3) throw err("OverconstrainedError");
      return fakeStream;
    });
    assert.equal(s, fakeStream);
    assert.deepEqual(seen, CONSTRAINT_LADDER);
  });
  it("retries a busy camera before giving up", async () => {
    let n = 0;
    const s = await openRearCamera(
      async () => {
        n += 1;
        if (n === 1) throw err("NotReadableError");
        return fakeStream;
      },
      { busyDelayMs: 1 },
    );
    assert.equal(s, fakeStream);
    assert.equal(n, 2);
  });
  it("stops immediately when permission is denied", async () => {
    let n = 0;
    await assert.rejects(
      openRearCamera(async () => {
        n += 1;
        throw err("NotAllowedError");
      }),
    );
    assert.equal(n, 1);
  });
  it("gives app-specific advice when denied inside the Android app", () => {
    assert.match(describeCameraError(err("NotAllowedError"), true).message, /Android Settings/);
    assert.match(describeCameraError(err("NotAllowedError"), false).message, /address bar/);
  });
});

describe("walk smoothing", () => {
  it("ignores a single compass spike", () => {
    const f = new HeadingFilter(0.5);
    for (let i = 0; i < 10; i += 1) f.push(90);
    assert.ok(Math.abs(angleDiff(f.push(250), 90)) < 1);
  });
  it("follows a real turn that persists", () => {
    const f = new HeadingFilter(0.5);
    for (let i = 0; i < 10; i += 1) f.push(0);
    for (let i = 0; i < 20; i += 1) f.push(90);
    assert.ok(Math.abs(angleDiff(f.value()!, 90)) < 5);
  });
  it("snaps near-axis headings but keeps diagonal ones", () => {
    assert.equal(snapToAxis(8), 0);
    assert.equal(snapToAxis(-95), -90);
    assert.equal(snapToAxis(45), 45);
  });
  it("does not count a phone bump as a step, and debounces double peaks", () => {
    const d = new StepDetector();
    for (let t = 0; t < 2000; t += 20) d.push(9.81, t);
    assert.equal(d.push(30, 2000), false);
    const d2 = new StepDetector();
    for (let t = 0; t < 2000; t += 20) d2.push(9.81, t);
    let steps = 0;
    // Two peaks 200 ms apart = one heel strike ringing, not two steps.
    for (let t = 2000; t < 2400; t += 20) {
      const m = 9.81 + (t < 2100 || (t >= 2200 && t < 2300) ? 4 : -2);
      if (d2.push(m, t)) steps += 1;
    }
    assert.equal(steps, 1);
  });
});

describe("store helpers", () => {
  it("never reuses a property id on repeated imports", () => {
    const taken = new Set(["a", "a-copy"]);
    const id = uniqueId("a", taken);
    assert.equal(id, "a-copy2");
    taken.add(id);
    assert.equal(uniqueId("a", taken), "a-copy3");
  });
  it("moves to a real level when undo removed the shown one", () => {
    const p = newProperty("House", "ft");
    assert.equal(validLevel(p, "gone"), p.levels[0].id);
    assert.equal(validLevel(p, p.levels[0].id), p.levels[0].id);
  });
});
