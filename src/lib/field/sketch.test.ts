import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProposals,
  enclosingBox,
  findLines,
  parseDimension,
  parseFeet,
  roomNameFromLabel,
  type Seg,
} from "./sketch.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("parses feet-inch dimensions from sketches", () => {
  const cases: [string, number, number][] = [
    ["12'8 x 13'9", 12 + 8 / 12, 13 + 9 / 12],
    ["9'7x12'0", 9 + 7 / 12, 12],
    ["8'6 x 4'3", 8.5, 4.25],
    [`12'8" x 13'9"`, 12 + 8 / 12, 13 + 9 / 12],
    ["12’8 × 13’9", 12 + 8 / 12, 13 + 9 / 12],
    ["12 X 10", 12, 10],
    ["12' x 10'", 12, 10],
    ["12-6 x 10-3", 12.5, 10.25],
    ["11.5 x 9", 11.5, 9],
    ["9'7 X 12'O", 9 + 7 / 12, 12],
    ["MBR 14'2 x 12'", 14 + 2 / 12, 12],
  ];
  for (const [t, a, b] of cases) {
    const d = parseDimension(t);
    assert.ok(d, t);
    close(d!.a, a);
    close(d!.b, b);
  }
});

test("rejects things that are not dimensions", () => {
  for (const t of ["closet", "M.B.R.", "12'8", "x", "2 x", "12'14 x 10", "500 x 3"]) {
    assert.equal(parseDimension(t), null, t);
  }
});

test("parseFeet", () => {
  close(parseFeet("12'8")!, 12 + 8 / 12);
  close(parseFeet("12'")!, 12);
  assert.equal(parseFeet("12'13"), null);
});

test("room names from sketch labels", () => {
  assert.equal(roomNameFromLabel("M.B.R."), "Primary bed");
  assert.equal(roomNameFromLabel("closet"), "Closet");
  assert.equal(roomNameFromLabel("CL"), "Closet");
  assert.equal(roomNameFromLabel("BR 2"), "Bedroom 2");
  assert.equal(roomNameFromLabel("Kitchen"), "Kitchen");
  assert.equal(roomNameFromLabel("sunroom"), "Sunroom");
});

/** Draw a rectangle outline into an ink mask. */
function rect(ink: Uint8Array, w: number, x: number, y: number, rw: number, rh: number) {
  for (let t = 0; t < 2; t++) {
    for (let i = x; i <= x + rw; i++) {
      ink[(y + t) * w + i] = 1;
      ink[(y + rh - t) * w + i] = 1;
    }
    for (let j = y; j <= y + rh; j++) {
      ink[j * w + x + t] = 1;
      ink[j * w + x + rw - t] = 1;
    }
  }
}

test("finds box lines and the room box around a label", () => {
  const W = 400;
  const H = 300;
  const ink = new Uint8Array(W * H);
  rect(ink, W, 20, 20, 190, 206); // ~12'8 x 13'9 at 15 px/ft
  rect(ink, W, 210, 20, 144, 180); // 9'7 x 12'0
  const segs = findLines(ink, W, H);
  assert.ok(segs.some((s) => s.o === "h"));
  assert.ok(segs.some((s) => s.o === "v"));
  const b = enclosingBox(segs, 100, 100)!;
  assert.ok(Math.abs(b.x - 20) < 3 && Math.abs(b.x + b.w - 210) < 3, JSON.stringify(b));
});

test("builds placed room proposals from text + lines", () => {
  const segs: Seg[] = [
    { o: "h", at: 20, from: 20, to: 354 },
    { o: "h", at: 226, from: 20, to: 210 },
    { o: "h", at: 200, from: 210, to: 354 },
    { o: "v", at: 20, from: 20, to: 226 },
    { o: "v", at: 210, from: 20, to: 226 },
    { o: "v", at: 354, from: 20, to: 200 },
  ];
  const lines = [
    { text: "M.B.R.", x: 80, y: 90, w: 50, h: 14 },
    { text: "12'8 x 13'9", x: 70, y: 110, w: 80, h: 14 },
    { text: "closet", x: 255, y: 90, w: 50, h: 14 },
    { text: "9'7x12'0", x: 250, y: 110, w: 70, h: 14 },
  ];
  const r = buildProposals(lines, segs, 400);
  assert.equal(r.quality, "good");
  assert.equal(r.proposals.length, 2);
  const [a, b] = r.proposals;
  assert.equal(a.name, "Primary bed");
  assert.equal(b.name, "Closet");
  close(a.w, 12 + 8 / 12);
  close(a.l, 13 + 9 / 12);
  close(b.w, 9 + 7 / 12);
  close(b.l, 12);
  // Closet sits to the right of the bedroom, tops aligned.
  assert.ok(b.x > a.x + 10 && Math.abs(b.y - a.y) < 0.5, JSON.stringify(r.proposals));
});

test("no lines: still proposes rooms from text, marked partial", () => {
  const r = buildProposals(
    [
      { text: "Kitchen", x: 10, y: 10, w: 60, h: 14 },
      { text: "8'6 x 4'3", x: 10, y: 28, w: 70, h: 14 },
    ],
    [],
    500,
  );
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].name, "Kitchen");
  assert.equal(r.quality, "partial");
});

test("poor: labels only become rows with no size", () => {
  const r = buildProposals([{ text: "Living", x: 10, y: 10, w: 60, h: 14 }], [], 500);
  assert.equal(r.quality, "poor");
  assert.equal(r.proposals[0].name, "Living");
  assert.equal(r.proposals[0].w, 0);
});
