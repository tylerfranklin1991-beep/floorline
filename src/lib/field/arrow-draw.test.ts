import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addOpening,
  advanceLaserTarget,
  blankDraft,
  closetCaption,
  closetRectangle,
  closetRectPoints,
  closeDraft,
  commitDraft,
  directionVector,
  draftHistory,
  orientOpenings,
  pushDraft,
  shoot,
  shootMeters,
  startClosetChain,
  undoDraft,
} from "./arrow-draw.ts";
import { areaSummary } from "./materials.ts";
import { area, edges, formatLength, newProperty } from "./model.ts";
import { encodeMeters, parseDistanceMeters } from "./disto-protocol.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ~= ${b}`);

test("directions: 0° is up, 90° is right, 45° is up-right", () => {
  const up = directionVector(0);
  near(up.x, 0);
  near(up.y, -1);
  const right = directionVector(90);
  near(right.x, 1);
  near(right.y, 0);
  const diag = directionVector(45);
  near(diag.x, Math.SQRT1_2);
  near(diag.y, -Math.SQRT1_2);
  near(directionVector(360).y, -1);
  near(directionVector(-90).x, -1);
});

test("a rectangle walked with the arrows closes on the last shot with no gap", () => {
  let d = { ...blankDraft(90), headingDeg: 90 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 8, "ft")).draft;
  d = { ...d, headingDeg: 270 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 0 };
  const closed = must(shoot(d, 8, "ft"));
  assert.equal(closed.event, "closed");
  assert.equal(closed.event === "closed" && closed.closingError, 0);
  assert.equal(closed.draft.points.length, 4);
  assert.equal(closed.draft.roomClosed, true);
  near(area(closed.draft.points), 80);
});

test("a shot that misses the start by under 6 inches auto-closes and reports the miss", () => {
  let d = { ...blankDraft(90), headingDeg: 90 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 8, "ft")).draft;
  d = { ...d, headingDeg: 270 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 0 };
  const closed = must(shoot(d, 7.7, "ft"));
  assert.equal(closed.event, "closed");
  if (closed.event !== "closed") return;
  near(closed.closingError, 0.3);
  assert.equal(formatLength(closed.closingError, "ft"), `0'-4"`);
});

test("a shot that misses by 2 ft does not close", () => {
  let d = { ...blankDraft(90), headingDeg: 90 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 8, "ft")).draft;
  d = { ...d, headingDeg: 270 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 0 };
  const next = must(shoot(d, 6, "ft"));
  assert.equal(next.event, "segment");
  assert.equal(next.draft.points.length, 5);
  assert.equal(next.draft.roomClosed, false);
});

test("close room reports the gap back to the start", () => {
  let d = { ...blankDraft(0), headingDeg: 0 };
  d = must(shoot(d, 12, "ft")).draft;
  d = { ...d, headingDeg: 90 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 12, "ft")).draft;
  const closed = must(closeDraft(d));
  assert.equal(closed.event, "closed");
  if (closed.event !== "closed") return;
  near(closed.closingError, 10);
  assert.equal(formatLength(closed.closingError, "ft"), `10'`);
});

test("custom 30° segment and a DISTO float both extend the chain", () => {
  const d0 = { ...blankDraft(30), headingDeg: 30 };
  const stepped = must(shoot(d0, 10, "ft")).draft;
  const end = stepped.points[1];
  near(end.x, 5);
  near(end.y, -8.66);
  const meters = parseDistanceMeters(encodeMeters(3.048));
  assert.equal(meters.ok, true);
  if (!meters.ok) return;
  const fromLaser = must(shootMeters(blankDraft(90), meters.meters, "ft"));
  near(fromLaser.draft.points[1].x, 10);
  near(fromLaser.draft.points[1].y, 0);
});

test("opening on the current wall keeps width, center offset, and transition", () => {
  let d = must(shoot({ ...blankDraft(90), headingDeg: 90 }, 12, "ft")).draft;
  const placed = addOpening(d, { kind: "cased", width: 3, offset: 4, transition: "t-mold", id: "o1" });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(placed.draft.openings.length, 1);
  assert.equal(placed.draft.openings[0].wall, 0);
  assert.equal(placed.draft.openings[0].width, 3);
  assert.equal(placed.draft.openings[0].transition, "t-mold");
  assert.equal(addOpening(d, { kind: "door", width: 30, offset: 6, transition: "auto" }).ok, false);
  assert.equal(addOpening(d, { kind: "door", width: 3, offset: 0.5, transition: "none" }).ok, false);
});

test("closet width × depth hangs off the wall and captions its own area", () => {
  let d = must(shoot({ ...blankDraft(90), headingDeg: 90 }, 10, "ft")).draft;
  d = { ...d, closetName: "closet", closetInclude: true };
  const added = closetRectangle(d, 6 + 7 / 12, 7 + 4 / 12, true, "c1");
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const pts = added.closet.points;
  const caption = closetCaption("MBR", "closet", pts, "ft");
  assert.match(caption, /^MBR closet 6'-7" × 7'-4" = \d+\.\d{2} sf$/);
  assert.ok(Math.abs(area(pts) - (6 + 7 / 12) * (7 + 4 / 12)) < 0.06);
  const rect = closetRectPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 3, true);
  assert.equal(rect[0].y, 0);
  assert.equal(rect[3].y, -3);
});

test("arrow-drawn closet closes onto its own chain", () => {
  let d = must(shoot({ ...blankDraft(90), headingDeg: 90 }, 10, "ft")).draft;
  const started = startClosetChain(d);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  d = { ...started.draft, headingDeg: 0 };
  d = must(shoot(d, 4, "ft")).draft;
  d = { ...d, headingDeg: 90 };
  d = must(shoot(d, 3, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 4, "ft")).draft;
  d = { ...d, headingDeg: 270 };
  const closed = must(shoot(d, 3, "ft"));
  assert.equal(closed.event, "closed");
  assert.equal(closed.draft.closetChain, null);
  assert.equal(closed.draft.closets.length, 1);
  assert.equal(closed.draft.points.length, 2);
});

test("commit keeps a cased opening and rolls an included closet into the parent total only", () => {
  let d = { ...blankDraft(90), headingDeg: 90 };
  d = must(shoot(d, 10, "ft")).draft;
  d = { ...d, headingDeg: 180 };
  d = must(shoot(d, 8, "ft")).draft;
  const opened = addOpening(d, { kind: "cased", width: 2.5, offset: 4, transition: "none", id: "op" });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  d = opened.draft;
  d = { ...d, closetInclude: true, closetName: "closet" };
  const box = closetRectangle(d, 4, 3, false, "cl");
  assert.equal(box.ok, true);
  if (!box.ok) return;
  d = must(closeDraft({ ...box.draft, headingDeg: 270 })).draft;
  // 10 right, 8 down, close across 10 — not a clean rectangle, but it closes.
  let n = 0;
  const ids = (prefix: string) => `${prefix}-${++n}`;
  const committed = commitDraft(d, {
    name: "MBR",
    levelId: "level-main",
    units: "ft",
    origin: { x: 0, y: 0 },
    ids,
  });
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.committed.openings[0].kind, "opening");
  assert.equal(committed.committed.openings[0].cased, true);
  assert.equal(committed.committed.openings[0].transition, "none");
  assert.equal(committed.committed.closets[0].closet?.includeInParent, true);
  assert.equal(committed.committed.closets[0].flooring?.material, "none");
  const prop = newProperty("Job");
  prop.rooms = [committed.committed.room, ...committed.committed.closets];
  prop.openings = committed.committed.openings;
  const summary = areaSummary(prop);
  const parent = summary.rooms.find((r) => r.id === committed.committed.room.id)!;
  const closet = summary.rooms.find((r) => r.id === committed.committed.closets[0].id)!;
  near(closet.area, 12);
  near(parent.area, area(committed.committed.room.points) + 12);
  near(summary.total, parent.area);
  // Listed separately: the closet counts on its own and the parent does not swallow it.
  committed.committed.closets[0].closet = { parentId: committed.committed.room.id, includeInParent: false };
  const separate = areaSummary(prop);
  const parent2 = separate.rooms.find((r) => r.id === committed.committed.room.id)!;
  near(parent2.area, area(committed.committed.room.points));
  near(separate.total, parent2.area + 12);
});

test("undo drops the last segment, opening, and closet", () => {
  let h = draftHistory(90);
  h = pushDraft(h, { ...h.present, headingDeg: 90 });
  const first = must(shoot(h.present, 10, "ft"));
  h = pushDraft(h, first.draft);
  const second = must(shoot({ ...h.present, headingDeg: 180 }, 8, "ft"));
  h = pushDraft(h, second.draft);
  const opened = addOpening(h.present, { kind: "door", width: 2, offset: 4, transition: "auto", id: "d" });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  h = pushDraft(h, opened.draft);
  const closet = closetRectangle(h.present, 3, 2, true, "c");
  assert.equal(closet.ok, true);
  if (!closet.ok) return;
  h = pushDraft(h, closet.draft);
  assert.equal(h.present.closets.length, 1);
  h = undoDraft(h);
  assert.equal(h.present.closets.length, 0);
  assert.equal(h.present.openings.length, 1);
  h = undoDraft(h);
  assert.equal(h.present.openings.length, 0);
  h = undoDraft(h);
  assert.equal(h.present.points.length, 2);
  h = undoDraft(h);
  assert.equal(h.present.points.length, 1);
});

test("reversing a counter-clockwise ring keeps the opening on the same edge", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 8 },
    { x: 10, y: 8 },
    { x: 10, y: 0 },
  ];
  const opening = {
    id: "o",
    kind: "door" as const,
    wall: 0,
    offset: 3,
    width: 2,
    transition: "auto" as const,
  };
  const out = orientOpenings(points, [opening]);
  assert.equal(out.points[0].x, 10);
  const edge = edges(out.points)[out.openings[0].wall];
  const along = edge.length;
  const cx = edge.a.x + ((edge.b.x - edge.a.x) / along) * out.openings[0].offset;
  const cy = edge.a.y + ((edge.b.y - edge.a.y) / along) * out.openings[0].offset;
  near(cx, 0);
  near(cy, 3);
});

test("laser selection advances to the next wall, then the next room", () => {
  const rooms = [
    { id: "a", wallCount: 4 },
    { id: "b", wallCount: 4 },
  ];
  assert.deepEqual(advanceLaserTarget(rooms, "a", 1), { roomId: "a", wall: 2 });
  assert.deepEqual(advanceLaserTarget(rooms, "a", 3), { roomId: "b", wall: 0 });
  assert.equal(advanceLaserTarget(rooms, "b", 3), null);
});

function must<T extends { ok: true }>(r: T | { ok: false; reason: string }): T {
  assert.equal(r.ok, true, "ok" in r && r.ok === false ? r.reason : "");
  return r as T;
}
